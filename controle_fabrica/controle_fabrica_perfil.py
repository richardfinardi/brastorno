# Instalar ao lado de auth.py, conexao.py e da API FastAPI.
# Na API principal: from controle_fabrica_perfil import router as controle_fabrica_router
#                  app.include_router(controle_fabrica_router)
# O login JWT existente permanece inalterado.
from fastapi import APIRouter, Depends, HTTPException, Response
from auth import obter_usuario_logado
from conexao import get_conn
import os

router = APIRouter(prefix="/controle_fabrica", tags=["Controle de Fábrica"])
PERMISSOES = ("U_GESTOR", "U_ENG", "U_PCP", "U_COMPRAS", "U_PROD", "U_CQ", "U_FAT", "U_EXP")

def _habilitado(valor):
    if isinstance(valor, bool):
        return valor
    if isinstance(valor, (int, float)):
        return valor != 0
    return str(valor or "").strip().upper() in ("1", "S", "SIM", "T", "TRUE", "Y", "YES")

def permissoes_do_usuario(usuario: str):
    """Lê sempre no CPS: nenhuma permissão é aceita do browser ou do JWT sem consulta."""
    conn = get_conn()
    try:
        cursor = conn.cursor()
        placeholder = "?" if os.getenv("DB_ENGINE", "1") == "2" else "%s"
        campos = ", ".join(PERMISSOES)
        cursor.execute(
            "SELECT NOME, " + campos + " FROM CSENHA "
            "WHERE UPPER(NOME) = " + placeholder + " "
            "AND COD_EMPRESA = 1 AND (INATIVO = 0 OR INATIVO IS NULL)",
            (str(usuario).strip().upper(),)
        )
        linha = cursor.fetchone()
        if linha is None:
            raise HTTPException(status_code=403, detail="Usuário não localizado/ativo no CPS.")
        chaves = [str(col[0]).upper() for col in cursor.description]
        dados = dict(zip(chaves, linha))
        perfil = {p: _habilitado(dados.get(p)) for p in PERMISSOES}
        if not any(perfil.values()):
            raise HTTPException(status_code=403, detail="Usuário não possui liberação de Controle de Fábrica.")
        return {"usuario": str(dados.get("NOME") or usuario), **perfil}
    finally:
        conn.close()

@router.get("/perfil")
def consultar_perfil(response: Response, usuario: str = Depends(obter_usuario_logado)):
    response.headers["Cache-Control"] = "no-store, private"
    return permissoes_do_usuario(usuario)

# Importante para o serviço: a checagem do front end é apenas apresentação.
# O /controle_fabrica (retorno de dados), o POST /solicitacoes e a aprovação
# também DEVEM exigir JWT e aplicar permissoes_do_usuario(usuario) no servidor.
# U_GESTOR pode acessar tudo. Outros só recebem registros com COD_STATUS
# permitido por seus U_*, sem permitir que o usuário passe "perfil" pela URL.
# Nunca efetivar a alteração de status no POST de solicitação.
