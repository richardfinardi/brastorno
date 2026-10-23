"""Correções isoladas BRASTORNO: tipo persistido e status CPS direto pelo gestor.
Instalação na API principal, APÓS criar app:
    from controle_fabrica_ajustes import router as ajustes_router
    app.include_router(ajustes_router)
Rotas diferentes das antigas: preserva os demais endpoints e SQL dinâmico.
"""
import os
import sqlite3
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from auth import obter_usuario_logado
from conexao import get_conn

router = APIRouter(prefix="/controle_fabrica", tags=["Controle de Fábrica — ajustes"])
P = "?" if os.getenv("DB_ENGINE", "1") == "2" else "%s"
IS_PG = os.getenv("DB_ENGINE", "1") != "2"
BR = timezone(timedelta(hours=-3))
STATUS = {6:"ENGENHARIA",7:"PCP",8:"COMPRAS",9:"PRODUÇÃO",10:"QUALIDADE",
          11:"FATURAMENTO",12:"EXPEDIÇÃO",13:"CONCLUÍDO",14:"PARALISADO",15:"CANCELADO"}


class TipoPayload(BaseModel):
    cod_classificacao: int | None = None
    origem: str = "orcamento"
    classificacao: str | None = Field(default=None, max_length=120)


class StatusPayload(BaseModel):
    status_novo: str | int
    observacao: str | None = Field(default=None, max_length=10000)


def normalizar(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "").upper().strip())
                   if unicodedata.category(c) != "Mn")


def gestor(usuario):
    conn = get_conn()
    try:
        cur = conn.cursor()
        try:
            cur.execute(f"""SELECT u_gestor FROM csenha WHERE cod_empresa=1
                AND UPPER(TRIM(nome))={P} AND (inativo=0 OR inativo IS NULL)""",
                (str(usuario).strip().upper(),))
            r=cur.fetchone()
            if not r or normalizar(r[0]) not in ("1","T","TRUE","S","SIM","YES"):
                raise HTTPException(403, "Somente o gestor pode alterar estes dados.")
        finally:
            cur.close()
    finally:
        conn.close()


def registrar(anterior, usuario, acao):
    data=datetime.now(BR).strftime("%d/%m/%Y %H:%M:%S")
    linha=f"=== HISTORICO | {data} | {str(usuario).upper()} | {acao} ===\n=== FIM ==="
    if isinstance(anterior, memoryview):
        anterior=anterior.tobytes()
    if isinstance(anterior, (bytes, bytearray)):
        texto=bytes(anterior).decode("cp1252", errors="replace")
        return (linha+"\n\n"+texto).encode("cp1252", errors="replace")
    return linha+"\n\n"+str(anterior or "")


def catalogs(cur):
    d={}
    for origem,tabela in (("servico","tclassific_serv"),("orcamento","tcla_orcamento")):
        cur.execute(f"SELECT codigo,descricao FROM {tabela}")
        d[origem]=[(int(c),str(t or "").strip()) for c,t in cur.fetchall() if str(t or "").strip()]
    return d


def resolver(cur, payload, com_os=True):
    if payload.origem not in ("orcamento","servico"):
        raise HTTPException(422, "Origem de classificação inválida.")
    c=catalogs(cur)
    fonte=c[payload.origem]
    achados=([t for cod,t in fonte if cod==payload.cod_classificacao]
             if payload.cod_classificacao is not None else
             [t for cod,t in fonte if normalizar(t)==normalizar(payload.classificacao)])
    if len(achados)!=1:
        raise HTTPException(422, "Classificação não encontrada ou ambígua no cadastro.")
    desc=achados[0]
    ids={}
    for orig in ("orcamento","servico"):
        ach=[cod for cod,t in c[orig] if normalizar(t)==normalizar(desc)]
        if len(ach)!=1 and (orig=="orcamento" or com_os):
            raise HTTPException(422, f"Classificação '{desc}' sem código único em {orig}.")
        ids[orig]=ach[0] if len(ach)==1 else None
    return desc,ids


def vinculados(cur, cod_os):
    cur.execute(f"""SELECT DISTINCT o.codigo FROM torcamento o
        JOIN torcamento_itens oi ON oi.cod_empresa=o.cod_empresa AND oi.cod_orcamento=o.codigo
        JOIN tsol_max_os sm ON sm.cod_empresa=oi.cod_empresa AND sm.guid_lm=oi.guid_linha
        JOIN tos_solicitacao_necessidade sn
          ON sn.cod_empresa=sm.cod_empresa AND sn.guid_solicitacao=sm.guid_pai
        WHERE o.cod_empresa=1 AND sn.cod_empresa=1 AND sn.cod_os={P}""",(cod_os,))
    return [int(r[0]) for r in cur.fetchall()]


def gravar_tipo_os(cod_os,payload,usuario):
    gestor(usuario)
    conn=get_conn()
    try:
        cur=conn.cursor()
        try:
            lock=" FOR UPDATE" if IS_PG else ""
            cur.execute(f"""SELECT classificacao,cod_classificacao,u_hist
                FROM tos WHERE cod_empresa=1 AND codigo={P}{lock}""",(cod_os,))
            antes=cur.fetchone()
            if antes is None:
                raise HTTPException(404, "OS não localizada.")
            cods=vinculados(cur,cod_os)
            desc,ids=resolver(cur,payload,com_os=True)
            cur.execute(f"""UPDATE tos SET classificacao={P},cod_classificacao={P},u_hist={P}
                WHERE cod_empresa=1 AND codigo={P}""",
                (desc,ids["servico"],registrar(antes[2],usuario,
                f"TIPO OS {cod_os}: {antes[0] or '—'} -> {desc}"),cod_os))
            if cur.rowcount!=1:
                raise HTTPException(409,"Falha ao gravar classificação da OS.")
            for cod in cods:
                cur.execute(f"""UPDATE torcamento SET classificacao={P},cod_classificacao={P}
                    WHERE cod_empresa=1 AND codigo={P}""",(desc,ids["orcamento"],cod))
                if cur.rowcount!=1:
                    raise HTTPException(409,f"Orçamento {cod} não atualizado.")
            cur.execute(f"SELECT classificacao,cod_classificacao FROM tos WHERE cod_empresa=1 AND codigo={P}",(cod_os,))
            ver=cur.fetchone()
            if ver is None or normalizar(ver[0])!=normalizar(desc) or int(ver[1] or -1)!=ids["servico"]:
                raise HTTPException(409,"Tipo não conferiu após a gravação.")
            if cods:
                placeholders=",".join([P]*len(cods))
                cur.execute(f"SELECT COUNT(*) FROM torcamento WHERE cod_empresa=1 AND codigo IN ({placeholders}) AND classificacao={P} AND cod_classificacao={P}",(*cods,desc,ids["orcamento"]))
                if int(cur.fetchone()[0])!=len(cods):
                    raise HTTPException(409,"Tipo dos orçamentos vinculados não conferiu.")
            conn.commit()
            return {"status":"sucesso","cod_os":cod_os,"classificacao":desc,
                    "cod_classificacao":ids["servico"],"orcamentos_verificados":len(cods)}
        finally:
            cur.close()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def gravar_tipo_orc(guid,payload,usuario):
    gestor(usuario)
    conn=get_conn()
    try:
        cur=conn.cursor()
        try:
            expr="CAST(oi.guid_linha AS VARCHAR(64))" if not IS_PG else "oi.guid_linha::text"
            cur.execute(f"""SELECT DISTINCT o.codigo,o.classificacao FROM torcamento o
                JOIN torcamento_itens oi ON oi.cod_empresa=o.cod_empresa AND oi.cod_orcamento=o.codigo
                WHERE o.cod_empresa=1 AND UPPER({expr})=UPPER({P})""",(guid.strip(),))
            rows=cur.fetchall()
            if len(rows)!=1:
                raise HTTPException(404 if not rows else 409,"Item de orçamento não identificado unicamente.")
            cod,antes=rows[0]
            cur.execute(f"""SELECT COUNT(DISTINCT sn.cod_os)
                FROM torcamento_itens oi
                JOIN tsol_max_os sm ON sm.cod_empresa=oi.cod_empresa AND sm.guid_lm=oi.guid_linha
                JOIN tos_solicitacao_necessidade sn ON sn.cod_empresa=sm.cod_empresa AND sn.guid_solicitacao=sm.guid_pai
                WHERE oi.cod_empresa=1 AND oi.cod_orcamento={P}""",(cod,))
            if int(cur.fetchone()[0] or 0):
                raise HTTPException(409,"Orçamento vinculado a OS: edite o tipo pela OS.")
            desc,ids=resolver(cur,payload,com_os=False)
            cur.execute(f"UPDATE torcamento SET classificacao={P},cod_classificacao={P} WHERE cod_empresa=1 AND codigo={P}",
                        (desc,ids["orcamento"],cod))
            if cur.rowcount!=1:
                raise HTTPException(409,"Orçamento não gravado.")
            cur.execute(f"SELECT classificacao,cod_classificacao FROM torcamento WHERE cod_empresa=1 AND codigo={P}",(cod,))
            depois=cur.fetchone()
            if not depois or normalizar(depois[0])!=normalizar(desc) or int(depois[1] or -1)!=ids["orcamento"]:
                raise HTTPException(409,"Classificação do orçamento não conferiu.")
            conn.commit()
            return {"status":"sucesso","cod_orcamento":int(cod),"classificacao":desc}
        finally:
            cur.close()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()



def _todos_status(cur):
    # Consulta sempre o cadastro CPS. Nenhuma lista fixa de códigos.
    cur.execute("SELECT codigo,nome FROM tst_serv WHERE cod_empresa=1 ORDER BY codigo")
    valores=[]
    for codigo,nome in cur.fetchall():
        if codigo is not None and str(nome or "").strip():
            valores.append({"codigo":int(codigo),"nome":str(nome).strip()})
    return valores


def _resolver_status(cur, entrada):
    todos=_todos_status(cur)
    try:
        numero=int(entrada)
    except (ValueError,TypeError):
        numero=None
    encontrados=([x for x in todos if x["codigo"]==numero] if numero is not None
               else [x for x in todos if normalizar(x["nome"])==normalizar(entrada)])
    if len(encontrados)!=1:
        raise HTTPException(422,"Status não encontrado ou ambíguo em TST_SERV (empresa 1).")
    return encontrados[0]


def consultar_status(usuario):
    gestor(usuario)
    conn=get_conn()
    try:
        cur=conn.cursor()
        try:
            return {"status":_todos_status(cur)}
        finally:
            cur.close()
    finally:
        conn.close()


def gravar_status(cod_os,payload,usuario):
    gestor(usuario)
    conn=get_conn()
    try:
        cur=conn.cursor()
        try:
            destino=_resolver_status(cur,payload.status_novo)
            codigo,nome=destino["codigo"],destino["nome"]
            lock=" FOR UPDATE" if IS_PG else ""
            cur.execute(f"""SELECT cod_status,status_servico,u_hist FROM tos
                WHERE cod_empresa=1 AND codigo={P}{lock}""",(cod_os,))
            antes=cur.fetchone()
            if not antes:
                raise HTTPException(404,"OS não encontrada.")
            if int(antes[0] or 0)==codigo and normalizar(antes[1])==normalizar(nome):
                return {"status":"sem_alteracao","cod_os":cod_os,
                        "cod_status":codigo,"status_servico":nome}
            log=registrar(antes[2],usuario,
                f"STATUS CPS GESTOR: {antes[0]} ({antes[1]}) -> {codigo} ({nome})"+(
                f" | OBS: {payload.observacao.strip()}" if payload.observacao and payload.observacao.strip() else ""))
            # Concluído e cancelado afetam as flags do CPS; os demais status as reabrem.
            concluido=int(normalizar(nome)=="CONCLUIDO" or codigo==13)
            cancelado=int(normalizar(nome)=="CANCELADO" or codigo==15)
            cur.execute(f"""UPDATE tos SET cod_status={P},status_servico={P},
                aprovado=1,concluido={P},cancelado={P},u_hist={P}
                WHERE cod_empresa=1 AND codigo={P}""",
                (codigo,nome,concluido,cancelado,log,cod_os))
            if cur.rowcount!=1:
                raise HTTPException(409,"Status não gravado.")
            cur.execute(f"SELECT cod_status,status_servico,concluido,cancelado FROM tos WHERE cod_empresa=1 AND codigo={P}",(cod_os,))
            depois=cur.fetchone()
            if (not depois or int(depois[0] or 0)!=codigo or normalizar(depois[1])!=normalizar(nome)
                or int(depois[2] or 0)!=concluido or int(depois[3] or 0)!=cancelado):
                raise HTTPException(409,"Status não conferiu após a gravação.")
            conn.commit()
        finally:
            cur.close()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    # Pendências anteriores não podem sobrescrever o status gravado pelo gestor.
    fila=Path(os.getenv("CONTROLE_FABRICA_DB") or Path(__file__).resolve().parent/"controle_fabrica_pendencias.sqlite3")
    if fila.is_file():
        try:
            with sqlite3.connect(str(fila),timeout=10) as db:
                db.execute("""UPDATE movimentacoes SET status='CANCELADO',
                    avaliado_em=?,avaliado_por=? WHERE cod_os=? AND status='PENDENTE'""",
                    (datetime.now(BR).isoformat(timespec="seconds"),usuario,cod_os))
        except sqlite3.Error:
            pass
    return {"status":"sucesso","cod_os":cod_os,"cod_status":codigo,
            "status_servico":nome,"concluido":bool(concluido),"cancelado":bool(cancelado)}


def gravar_status_orc(guid,payload,usuario):
    """Orçamento sem OS: salva seu status na STRING1 sem fingir que existe TOS."""
    gestor(usuario)
    conn=get_conn()
    try:
        cur=conn.cursor()
        try:
            destino=_resolver_status(cur,payload.status_novo)
            expr="CAST(oi.guid_linha AS VARCHAR(64))" if not IS_PG else "oi.guid_linha::text"
            lock=" FOR UPDATE" if IS_PG else ""
            cur.execute(f"""SELECT oi.cod_orcamento,oi.string1 FROM torcamento_itens oi
                WHERE oi.cod_empresa=1 AND UPPER({expr})=UPPER({P}){lock}""",(guid.strip(),))
            reg=cur.fetchall()
            if len(reg)!=1:
                raise HTTPException(404 if not reg else 409,"Item não localizado unicamente.")
            orc_id,anterior=reg[0]
            cur.execute(f"""SELECT COUNT(*) FROM torcamento_itens oi
                JOIN tsol_max_os sm ON sm.cod_empresa=oi.cod_empresa AND sm.guid_lm=oi.guid_linha
                JOIN tos_solicitacao_necessidade sn
                ON sn.cod_empresa=sm.cod_empresa AND sn.guid_solicitacao=sm.guid_pai
                WHERE oi.cod_empresa=1 AND oi.cod_orcamento={P} AND UPPER({expr})=UPPER({P})""",
                (orc_id,guid.strip()))
            if int(cur.fetchone()[0] or 0):
                raise HTTPException(409,"Este item possui OS. Mude o status da OS.")
            nome=destino["nome"]
            if normalizar(anterior)==normalizar(nome):
                return {"status":"sem_alteracao","status_novo":nome}
            cur.execute(f"""UPDATE torcamento_itens SET string1={P}
                WHERE cod_empresa=1 AND UPPER(CAST(guid_linha AS VARCHAR(64)))=UPPER({P})""",
                (nome,guid.strip()))
            if cur.rowcount!=1:
                raise HTTPException(409,"Status do orçamento não gravado.")
            cur.execute(f"""SELECT string1 FROM torcamento_itens
                WHERE cod_empresa=1 AND UPPER(CAST(guid_linha AS VARCHAR(64)))=UPPER({P})""",(guid.strip(),))
            ver=cur.fetchone()
            if not ver or normalizar(ver[0])!=normalizar(nome):
                raise HTTPException(409,"Status de orçamento não conferiu.")
            conn.commit()
            return {"status":"sucesso","status_novo":nome,"cod_orcamento":orc_id}
        finally:
            cur.close()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.patch("/os/{cod_os}/tipo_corrigido")
async def tipo_os(cod_os:int,payload:TipoPayload,usuario:str=Depends(obter_usuario_logado)):
    return await run_in_threadpool(gravar_tipo_os,cod_os,payload,usuario)


@router.patch("/orcamento_item/{guid}/tipo_corrigido")
async def tipo_orc(guid:str,payload:TipoPayload,usuario:str=Depends(obter_usuario_logado)):
    return await run_in_threadpool(gravar_tipo_orc,guid,payload,usuario)


@router.patch("/os/{cod_os}/status_direto")
async def status_os(cod_os:int,payload:StatusPayload,usuario:str=Depends(obter_usuario_logado)):
    return await run_in_threadpool(gravar_status,cod_os,payload,usuario)

@router.get("/status_cps_catalogo")
async def status_cps_catalogo(usuario:str=Depends(obter_usuario_logado)):
    return await run_in_threadpool(consultar_status,usuario)


@router.patch("/orcamento_item/{guid}/status_direto")
async def status_orc(guid:str,payload:StatusPayload,usuario:str=Depends(obter_usuario_logado)):
    return await run_in_threadpool(gravar_status_orc,guid,payload,usuario)
