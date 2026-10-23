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


def gravar_status(cod_os,payload,usuario):
    gestor(usuario)
    v=payload.status_novo
    try:
        codigo=int(v)
    except (TypeError,ValueError):
        codigo=next((c for c,s in STATUS.items() if normalizar(s)==normalizar(v)),None)
    if codigo not in STATUS:
        raise HTTPException(422,"Status inválido (permitidos 6 a 15).")
    conn=get_conn()
    try:
        cur=conn.cursor()
        try:
            lock=" FOR UPDATE" if IS_PG else ""
            cur.execute(f"""SELECT cod_status,status_servico,u_hist FROM tos
                WHERE cod_empresa=1 AND codigo={P}{lock}""",(cod_os,))
            antes=cur.fetchone()
            if not antes:
                raise HTTPException(404,"OS não encontrada.")
            if int(antes[0] or 0)==codigo and normalizar(antes[1])==normalizar(STATUS[codigo]):
                return {"status":"sem_alteracao","cod_os":cod_os,"cod_status":codigo,"status_servico":STATUS[codigo]}
            log=registrar(antes[2],usuario,
                f"STATUS CPS GESTOR: {antes[0]} ({antes[1]}) -> {codigo} ({STATUS[codigo]})"+(
                f" | OBS: {payload.observacao.strip()}" if payload.observacao and payload.observacao.strip() else ""))
            cur.execute(f"""UPDATE tos SET cod_status={P},status_servico={P},
                aprovado=1,concluido={P},cancelado={P},u_hist={P}
                WHERE cod_empresa=1 AND codigo={P}""",
                (codigo,STATUS[codigo],int(codigo==13),int(codigo==15),log,cod_os))
            if cur.rowcount!=1:
                raise HTTPException(409,"Status não gravado.")
            cur.execute(f"SELECT cod_status,status_servico,concluido,cancelado FROM tos WHERE cod_empresa=1 AND codigo={P}",(cod_os,))
            depois=cur.fetchone()
            if (not depois or int(depois[0] or 0)!=codigo or normalizar(depois[1])!=normalizar(STATUS[codigo])
                or int(depois[2] or 0)!=int(codigo==13) or int(depois[3] or 0)!=int(codigo==15)):
                raise HTTPException(409,"Status não conferiu após a gravação.")
            conn.commit()
        finally:
            cur.close()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    # Cancelar solicitações antigas dessa OS para não reaplicar status desatualizado.
    fila=Path(os.getenv("CONTROLE_FABRICA_DB") or Path(__file__).resolve().parent/"controle_fabrica_pendencias.sqlite3")
    if fila.is_file():
        try:
            with sqlite3.connect(str(fila),timeout=10) as db:
                db.execute("""UPDATE movimentacoes SET status='CANCELADO',
                    avaliado_em=?,avaliado_por=? WHERE cod_os=? AND status='PENDENTE'""",
                    (datetime.now(BR).isoformat(timespec="seconds"),usuario,cod_os))
        except sqlite3.Error:
            pass  # CPS já foi gravado: jamais reportar que o status não foi salvo.
    return {"status":"sucesso","cod_os":cod_os,"cod_status":codigo,
            "status_servico":STATUS[codigo],"concluido":codigo==13,"cancelado":codigo==15}


@router.patch("/os/{cod_os}/tipo_corrigido")
async def tipo_os(cod_os:int,payload:TipoPayload,usuario:str=Depends(obter_usuario_logado)):
    return await run_in_threadpool(gravar_tipo_os,cod_os,payload,usuario)


@router.patch("/orcamento_item/{guid}/tipo_corrigido")
async def tipo_orc(guid:str,payload:TipoPayload,usuario:str=Depends(obter_usuario_logado)):
    return await run_in_threadpool(gravar_tipo_orc,guid,payload,usuario)


@router.patch("/os/{cod_os}/status_direto")
async def status_os(cod_os:int,payload:StatusPayload,usuario:str=Depends(obter_usuario_logado)):
    return await run_in_threadpool(gravar_status,cod_os,payload,usuario)
