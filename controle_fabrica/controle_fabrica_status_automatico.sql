/*
 BRASTORNO | STATUS AUTOMATICO UNICO - V4
 Uma linha por OS ativa. SOMENTE LEITURA: nao altera COD_STATUS nem STATUS_SERVICO.
 Fontes: TOS + TLIS_MAT + TORD_AUX_OS + TAPONTA_ABERTO + TCTRL_PH.
 Sem TSOL_MAX_OS, TCOM_AUX_OS, TOS_AUX, TPRO_PRO ou TPRODUTO.
 Compra segue a relacao direta JA TESTADA: TLIS_MAT.GUID_LINHA = TORD_AUX_OS.GUID_LM.
 REGISTRO_ID = mesmo identificador da query principal do Controle de Fabrica.
*/
WITH
os_ativas AS MATERIALIZED (
    SELECT t.cod_empresa, t.codigo AS cod_os, t.n_os,
           t.cod_status, t.status_servico
    FROM tos t
    WHERE t.cancelado = 0
      AND COALESCE(t.concluido, 0) = 0
      AND t.n_os NOT LIKE 'E%'
      AND t.cod_status IS DISTINCT FROM 13
      AND t.cod_status IS DISTINCT FROM 15
),

-- Os apontamentos nao devem retroceder OS de QUALIDADE/FATURAMENTO/EXPEDICAO.
os_producao AS MATERIALIZED (
    SELECT * FROM os_ativas
    WHERE cod_status IN (6, 7, 8, 9)
),

-- 1. APONTAMENTO ATUAL: uma linha por OS.
apontamento_aberto AS MATERIALIZED (
    SELECT a.cod_empresa, a.cod_os,
           STRING_AGG(DISTINCT NULLIF(BTRIM(a.tp_maquina::text), ''), ' | ') AS maquinas
    FROM taponta_aberto a
    JOIN os_producao b
      ON b.cod_empresa = a.cod_empresa
     AND b.cod_os = a.cod_os
    GROUP BY a.cod_empresa, a.cod_os
),

-- 2. ULTIMO APONTAMENTO: busca o registro mais recente por OS.
-- Mantem a estrategia LATERAL LIMIT 1 da consulta separada de producao.
ultimo_apontamento AS MATERIALIZED (
    SELECT b.cod_empresa, b.cod_os,
           ph.data_fim AS data_ultimo_apontamento,
           NULLIF(BTRIM(ph.tp_maquina::text), '') AS ultima_maquina
    FROM os_producao b
    LEFT JOIN apontamento_aberto aa
      ON aa.cod_empresa = b.cod_empresa AND aa.cod_os = b.cod_os
    JOIN LATERAL (
        SELECT h.data_fim, h.tp_maquina
        FROM tctrl_ph h
        WHERE h.cod_empresa = b.cod_empresa
          AND h.cod_os = b.cod_os
          AND h.data_fim >= DATE '2024-01-01'
        ORDER BY h.data_fim DESC, h.cod_barr DESC NULLS LAST
        LIMIT 1
    ) ph ON TRUE
    WHERE aa.cod_os IS NULL
),

-- 3. OC: vinculo DIRETO que retornou instantaneamente no teste com 5085 OS.
oc_emitida AS MATERIALIZED (
    SELECT DISTINCT cod_empresa, guid_lm
    FROM tord_aux_os
    WHERE n_servico IS NOT NULL
      AND TRIM(n_servico) <> ''
),

-- 4. MATERIAIS + COMPRAS: agrega por OS antes de juntar aos apontamentos.
-- Sem joins que multiplicam linhas de materiais.
materiais_os AS MATERIALIZED (
    SELECT lm.cod_empresa, lm.cod_os,
           COUNT(*) AS total_itens,
           COUNT(*) FILTER (
               WHERE COALESCE(lm.processado, 0) <> 1
           ) AS nao_processados,
           COUNT(*) FILTER (
               WHERE COALESCE(lm.qtde, 0) > 0
           ) AS itens_necessarios,
           COUNT(*) FILTER (
               WHERE COALESCE(lm.qtde, 0) >
                   GREATEST(COALESCE(lm.qtde_reservada, 0),
                            COALESCE(lm.qtde_utilizada, 0))
           ) AS itens_indisponiveis,
           COUNT(*) FILTER (
               WHERE COALESCE(lm.qtde, 0) >
                   GREATEST(COALESCE(lm.qtde_reservada, 0),
                            COALESCE(lm.qtde_utilizada, 0))
                 AND COALESCE(lm.qtde_solicitada, 0) = 0
           ) AS sem_solicitacao,
           COUNT(*) FILTER (
               WHERE COALESCE(lm.qtde_solicitada, 0) > COALESCE(lm.qtde_entregue, 0)
                 AND oc.guid_lm IS NULL
           ) AS aguardando_oc,
           COUNT(*) FILTER (
               WHERE COALESCE(lm.qtde_solicitada, 0) > COALESCE(lm.qtde_entregue, 0)
                 AND oc.guid_lm IS NOT NULL
           ) AS aguardando_chegada
    FROM tlis_mat lm
    JOIN os_ativas b
      ON b.cod_empresa = lm.cod_empresa
     AND b.cod_os = lm.cod_os
    LEFT JOIN oc_emitida oc
      ON oc.cod_empresa = lm.cod_empresa
     AND oc.guid_lm = lm.guid_linha
    WHERE lm.destino IS DISTINCT FROM 3
    GROUP BY lm.cod_empresa, lm.cod_os
)

SELECT
    'OS:' || b.cod_empresa::text || ':' || b.cod_os::text AS registro_id,
    b.cod_empresa,
    b.cod_os,
    b.n_os,
    b.cod_status,  -- usado no filtro de permissoes da API
    b.status_servico AS status_cps,
    CASE
        -- Etapas que prevalecem sobre o historico de producao/compras.
        WHEN b.cod_status = 14 THEN 'PARALISADO'
        WHEN b.cod_status = 10 THEN 'QUALIDADE - Aguardando liberacao'
        WHEN b.cod_status = 11 THEN 'FATURAMENTO - Aguardando faturar'
        WHEN b.cod_status = 12 THEN 'EXPEDICAO - Aguardando expedicao'

        -- Producao atual vence compras; ultimo apontamento vence materiais.
        WHEN aa.cod_os IS NOT NULL THEN
            'PRODUCAO - Em execucao: ' || COALESCE(aa.maquinas, 'maquina nao informada')
        WHEN ua.cod_os IS NOT NULL THEN
            'PRODUCAO - Ultimo apontamento: ' || COALESCE(ua.ultima_maquina, 'maquina nao informada')

        -- Engenharia / lista.
        WHEN m.cod_os IS NULL AND b.cod_status = 6 THEN
            'ENGENHARIA - Aguardando lista de materiais'
        WHEN m.cod_os IS NULL AND b.cod_status = 9 THEN
            'PRODUCAO - Aguardando primeiro apontamento'
        WHEN m.cod_os IS NULL AND b.cod_status = 8 THEN
            'COMPRAS - Sem lista de materiais'
        WHEN m.cod_os IS NULL THEN
            'PCP - Sem lista de materiais'
        WHEN m.nao_processados > 0 THEN
            'ENGENHARIA - Aguardando processamento da LM'

        -- Materiais ja disponiveis: nao deixar compra extra atrasar a OS.
        WHEN m.itens_indisponiveis = 0 AND b.cod_status = 9 THEN
            'PRODUCAO - Aguardando primeiro apontamento'
        WHEN m.itens_indisponiveis = 0 AND m.itens_necessarios = 0 THEN
            'PCP - Sem necessidade de materiais'
        WHEN m.itens_indisponiveis = 0 THEN
            'PCP - Materiais disponiveis'

        -- Compras: SEM solicitacao > SEM OC > material encomendado.
        WHEN m.sem_solicitacao > 0 THEN
            'COMPRAS - Aguardando solicitacao de material'
        WHEN m.aguardando_oc > 0 THEN
            'COMPRAS - Aguardando emissao de OC'
        WHEN m.aguardando_chegada > 0 THEN
            'COMPRAS - Aguardando chegada de material'
        WHEN m.itens_indisponiveis > 0 THEN
            'ALMOXARIFADO - Aguardando reserva/separacao'

        ELSE
            'PCP - Aguardando disponibilidade de material'
    END AS status_automatico,
    -- Explica o motivo do status. Não modifica a regra de prioridade V4.
    CASE
        WHEN b.cod_status = 14 THEN 'OS marcada como paralisada no CPS'
        WHEN b.cod_status = 10 THEN 'Etapa de qualidade informada no CPS'
        WHEN b.cod_status = 11 THEN 'Etapa de faturamento informada no CPS'
        WHEN b.cod_status = 12 THEN 'Etapa de expedicao informada no CPS'
        WHEN aa.cod_os IS NOT NULL THEN
            'Apontamento em aberto: ' || COALESCE(aa.maquinas, 'maquina nao informada')
        WHEN ua.cod_os IS NOT NULL THEN
            'Ultimo apontamento: ' || COALESCE(ua.ultima_maquina, 'maquina nao informada')
            || ' em ' || TO_CHAR(ua.data_ultimo_apontamento, 'DD/MM/YYYY HH24:MI')
        WHEN m.cod_os IS NULL THEN 'Nenhuma lista de materiais registrada nesta OS'
        WHEN m.nao_processados > 0 THEN
            m.nao_processados::text || ' item(ns) da LM aguardando processamento'
        WHEN m.itens_indisponiveis = 0 AND m.itens_necessarios = 0 THEN
            'Nao ha itens com necessidade de materiais'
        WHEN m.itens_indisponiveis = 0 AND b.cod_status = 9 THEN
            'Materiais disponiveis; nenhum apontamento encontrado'
        WHEN m.itens_indisponiveis = 0 THEN
            m.total_itens::text || ' item(ns) na LM; materiais disponiveis'
        WHEN m.sem_solicitacao > 0 THEN
            m.sem_solicitacao::text || ' item(ns) sem solicitacao de material'
        WHEN m.aguardando_oc > 0 THEN
            m.aguardando_oc::text || ' item(ns) solicitados, sem OC emitida'
        WHEN m.aguardando_chegada > 0 THEN
            m.aguardando_chegada::text || ' item(ns) aguardando entrega/recebimento'
        WHEN m.itens_indisponiveis > 0 THEN
            m.itens_indisponiveis::text || ' item(ns) ainda indisponiveis para uso'
        ELSE 'Sem detalhe adicional registrado'
    END AS detalhamento_status
FROM os_ativas b
LEFT JOIN apontamento_aberto aa
  ON aa.cod_empresa = b.cod_empresa AND aa.cod_os = b.cod_os
LEFT JOIN ultimo_apontamento ua
  ON ua.cod_empresa = b.cod_empresa AND ua.cod_os = b.cod_os
LEFT JOIN materiais_os m
  ON m.cod_empresa = b.cod_empresa AND m.cod_os = b.cod_os
ORDER BY b.cod_os DESC;