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

# Fonte de dados do controle, protegida no servidor.
# Não depende de o frontend escolher sua própria permissão.
from pathlib import Path
from fastapi.encoders import jsonable_encoder

STATUS_POR_PERMISSAO = {
    "U_ENG": 6, "U_PCP": 7, "U_COMPRAS": 8, "U_PROD": 9,
    "U_CQ": 10, "U_FAT": 11, "U_EXP": 12,
}
CODIGOS_POR_TEXTO = {
    "ENGENHARIA": 6, "PCP": 7, "COMPRAS": 8, "PRODUÇÃO": 9,
    "PRODUCAO": 9, "QUALIDADE": 10, "FATURAMENTO": 11,
    "EXPEDIÇÃO": 12, "EXPEDICAO": 12, "CONCLUÍDO": 13,
    "CONCLUIDO": 13, "PARALISADO": 14, "CANCELADO": 15,
}

def _codigo_status(linha: dict):
    campos = {str(k).lower(): v for k, v in linha.items()}
    bruto = campos.get("cod_status")
    if bruto is not None:
        try:
            return int(bruto)
        except (ValueError, TypeError):
            pass
    status = str(campos.get("status_servico") or campos.get("status") or "").strip().upper()
    return CODIGOS_POR_TEXTO.get(status)

def _consulta_sql():
    pasta = Path(os.getenv("SQL_DIR") or (Path(__file__).resolve().parent / "sql"))
    if not pasta.is_dir():
        raise HTTPException(status_code=503, detail=f"Pasta SQL não encontrada: {pasta}")
    for arquivo in pasta.iterdir():
        if arquivo.is_file() and arquivo.suffix.lower() == ".sql" and arquivo.stem.lower() == "controle_fabrica":
            return arquivo.read_text(encoding="utf-8-sig")
    raise HTTPException(status_code=503, detail="controle_fabrica.sql não localizado na pasta SQL")

def _consulta_sql_historico():
    """Consulta de histórico guardada fora de sql/, sem endpoint automático público."""
    arquivo = Path(__file__).resolve().with_name("controle_fabrica_historico.sql")
    if not arquivo.is_file():
        raise HTTPException(status_code=503, detail="Arquivo de histórico não instalado ao lado do módulo da API.")
    return arquivo.read_text(encoding="utf-8-sig")


@router.get("/historico")
def consultar_historico(response: Response, usuario: str = Depends(obter_usuario_logado)):
    """Histórico somente para U_GESTOR. Consulta separada evita carregar finalizados na abertura."""
    perfil = permissoes_do_usuario(usuario)
    if not perfil["U_GESTOR"]:
        raise HTTPException(status_code=403, detail="Histórico permitido somente para o gestor.")
    conn = get_conn()
    try:
        cursor = conn.cursor()
        try:
            cursor.execute(_consulta_sql_historico())
            colunas = [d[0] for d in cursor.description]
            dados = [dict(zip(colunas, linha)) for linha in cursor.fetchall()]
        finally:
            cursor.close()
    finally:
        conn.close()
    response.headers["Cache-Control"] = "no-store, private"
    return jsonable_encoder({"dados": dados, "total": len(dados)})


@router.get("/dados")
def consultar_dados(response: Response, usuario: str = Depends(obter_usuario_logado)):
    perfil = permissoes_do_usuario(usuario)
    permitidos = {codigo for campo, codigo in STATUS_POR_PERMISSAO.items() if perfil[campo]}
    conn = get_conn()
    try:
        cursor = conn.cursor()
        cursor.execute(_consulta_sql())
        colunas = [d[0] for d in cursor.description]
        linhas = (dict(zip(colunas, v)) for v in cursor.fetchall())
        dados = list(linhas) if perfil["U_GESTOR"] else [
            linha for linha in linhas if _codigo_status(linha) in permitidos
        ]
        cursor.close()
    finally:
        conn.close()
    response.headers["Cache-Control"] = "no-store, private"
    return jsonable_encoder({"dados": dados, "total": len(dados)})
