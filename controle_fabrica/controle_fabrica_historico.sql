/* Apenas para GET /controle_fabrica/historico (somente U_GESTOR).
   Guardar ao lado de controle_fabrica_perfil.py, FORA da pasta sql/ que publica endpoints automaticamente.
   Concluído sem orçamento; 100% faturado com ou sem OS.
*/
WITH
os_base AS MATERIALIZED (
    SELECT t.cod_empresa, t.codigo AS cod_os, t.n_os, t.titulo,
           t.classificacao, t.qtde, t.dt_entrada, t.dt_prevista, t.u_prev_lib, t.cod_status,
           t.status_servico, t.obs,
           t.aprovado, t.concluido, t.cancelado
    FROM tos t
    WHERE
        t.cancelado = 0
        AND t.n_os NOT LIKE 'E%'
),

itens_aprovados AS MATERIALIZED (
    SELECT oi.cod_empresa, oi.cod_orcamento, oi.guid_linha,
           o.cliente, o.n_orcamento, o.versao, o.classificacao,
           o.dt_aprovacao, oi.n_pedido, oi.descricao, oi.qtde, oi.qtde_faturada,
           oi.dt_previsao_entrega,
           oi.preco_geral_com_custo_fin AS valor
    FROM torcamento o
    JOIN torcamento_itens oi
      ON oi.cod_empresa = o.cod_empresa
     AND oi.cod_orcamento = o.codigo
    WHERE o.status = 1
      AND oi.nivel = 0
),

vinculos AS MATERIALIZED (
    SELECT DISTINCT i.cod_empresa, i.guid_linha, sn.cod_os
    FROM itens_aprovados i
    JOIN tsol_max_os sm
      ON sm.cod_empresa = i.cod_empresa
     AND sm.guid_lm = i.guid_linha
    JOIN tos_solicitacao_necessidade sn
      ON sn.cod_empresa = sm.cod_empresa
     AND sn.guid_solicitacao = sm.guid_pai
),

orc_por_os AS (
    SELECT v.cod_empresa, v.cod_os,
           STRING_AGG(DISTINCT NULLIF(BTRIM(i.classificacao::text), ''), ' | ') AS classificacao,
           STRING_AGG(DISTINCT i.cliente::text, ' | ') AS cliente,
           STRING_AGG(DISTINCT CONCAT(i.n_orcamento, i.versao), ', ') AS orcamento,
           STRING_AGG(DISTINCT i.n_pedido::text, ', ') AS pedido,
           STRING_AGG(DISTINCT i.descricao, ' | ') AS descricao,
           MAX(i.dt_aprovacao) AS dt_aprovacao,
           MIN(i.dt_previsao_entrega) AS entrega_acordada,
           SUM(COALESCE(i.valor, 0)) AS valor,
           BOOL_AND(COALESCE(i.qtde, 0) > 0
                    AND COALESCE(i.qtde_faturada, 0) >= i.qtde) AS faturado_total
    FROM vinculos v
    JOIN itens_aprovados i
      ON i.cod_empresa = v.cod_empresa
     AND i.guid_linha = v.guid_linha
    GROUP BY v.cod_empresa, v.cod_os
),

/* Apenas serviços que ainda exigem alguma ação na fábrica/faturamento. */
os_pendentes AS MATERIALIZED (
    SELECT b.*
    FROM os_base b
    LEFT JOIN orc_por_os o
      ON o.cod_empresa = b.cod_empresa
     AND o.cod_os = b.cod_os
    WHERE b.cod_status IS DISTINCT FROM 15
      AND (
          -- Faturadas integralmente (com OS)
          COALESCE(o.faturado_total, FALSE)
          -- Concluídas sem orçamento aprovado vinculado
          OR (
              (COALESCE(b.concluido, 0) = 1 OR b.cod_status = 13)
              AND o.cod_os IS NULL
          )
      )
),

/* Orçamentos aprovados sem OS, apenas se ainda não faturados totalmente. */
orc_sem_os_pendentes AS MATERIALIZED (
    SELECT i.*
    FROM itens_aprovados i
    WHERE (COALESCE(i.qtde, 0) > 0
           AND COALESCE(i.qtde_faturada, 0) >= i.qtde)
      AND NOT EXISTS (
          SELECT 1 FROM vinculos v
          WHERE v.cod_empresa = i.cod_empresa
            AND v.guid_linha = i.guid_linha
      )
),

/* Só consultar NFs dos registros que efetivamente serão exibidos. */
guids_ativos AS MATERIALIZED (
    SELECT DISTINCT v.cod_empresa, v.guid_linha
    FROM vinculos v
    JOIN os_pendentes b
      ON b.cod_empresa = v.cod_empresa
     AND b.cod_os = v.cod_os
    UNION
    SELECT i.cod_empresa, i.guid_linha
    FROM orc_sem_os_pendentes i
),

notas_base AS MATERIALIZED (
    SELECT i.cod_empresa, i.guid_linha,
           nf.numero::text AS numero_nf, nf.dt_emissao
    FROM guids_ativos a
    JOIN itens_aprovados i
      ON i.cod_empresa = a.cod_empresa
     AND i.guid_linha = a.guid_linha
    JOIN tnota_fiscal_item nfi
      ON nfi.cod_empresa = i.cod_empresa
     AND nfi.cod_orcamento = i.cod_orcamento
     AND nfi.guid_orcamento = i.guid_linha
    JOIN tnota_fiscal nf
      ON nf.cod_empresa = nfi.cod_empresa
     AND nf.modelo = nfi.modelo
     AND nf.serie = nfi.serie
     AND nf.sub_serie = nfi.sub_serie
     AND nf.numero = nfi.numero_nf
    WHERE nf.nfe_cod_status IN ('100', '0')
),

notas_por_os AS (
    SELECT v.cod_empresa, v.cod_os,
           STRING_AGG(DISTINCT n.numero_nf, ', ') AS nf,
           STRING_AGG(DISTINCT TO_CHAR(n.dt_emissao, 'DD/MM/YYYY'), ', ') AS data_faturamento
    FROM vinculos v
    JOIN notas_base n
      ON n.cod_empresa = v.cod_empresa
     AND n.guid_linha = v.guid_linha
    GROUP BY v.cod_empresa, v.cod_os
),

notas_por_item AS (
    SELECT cod_empresa, guid_linha,
           STRING_AGG(DISTINCT numero_nf, ', ') AS nf,
           STRING_AGG(DISTINCT TO_CHAR(dt_emissao, 'DD/MM/YYYY'), ', ') AS data_faturamento
    FROM notas_base
    GROUP BY cod_empresa, guid_linha
),

linhas AS (
    -- OS com orçamento aprovado ou sem orçamento
    SELECT b.cod_empresa, b.cod_os,
           'OS:' || b.cod_empresa::text || ':' || b.cod_os::text AS registro_id,
           COALESCE(NULLIF(BTRIM(o.classificacao), ''), NULLIF(BTRIM(b.classificacao::text), '')) AS tipo,
           o.cliente, o.orcamento, b.n_os AS os,
           COALESCE(NULLIF(BTRIM(b.titulo), ''), NULLIF(BTRIM(o.descricao), '')) AS descricao,
           b.qtde::numeric AS quantidade,
           COALESCE(o.dt_aprovacao, b.dt_entrada) AS entrada_pv,
           COALESCE(o.entrega_acordada, b.dt_prevista) AS entrega_acordada,
           b.u_prev_lib AS prev_lib_manual, o.valor,
           b.cod_status, b.status_servico AS status,
           TRIM(REGEXP_REPLACE(
               REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                   ENCODE(b.obs, 'escape'),
                   $$\000$$, ''),
                   $$\\'ed$$, 'í'),
                   $$\\'e1$$, 'á'),
                   $$\\'e3$$, 'ã'),
                   $$\\'e7$$, 'ç'),
               $re${\\[^}]*}|\\[a-z0-9*]+(?:\s+|\d*)|[\{\}\\\|\\'']|\\012|\\015$re$,
               '', 'gi'
           )) AS observacoes,
           n.nf, n.data_faturamento,
           COALESCE(o.faturado_total, FALSE) AS faturado_total,
           (COALESCE(b.concluido, 0) = 1 OR b.cod_status = 13) AS os_concluida,
           CASE
               WHEN b.aprovado = 0 AND b.concluido = 0 AND b.cancelado = 0 THEN 'EM ABERTO'
               WHEN b.aprovado = 1 AND b.concluido = 0 AND b.cancelado = 0 THEN 'APROVADO'
               WHEN b.aprovado = 1 AND b.concluido = 1 AND b.cancelado = 0 THEN 'CONCLUIDO'
               WHEN b.cancelado = 1 THEN 'CANCELADO'
           END AS prosicao
    FROM os_pendentes b
    LEFT JOIN orc_por_os o
      ON o.cod_empresa = b.cod_empresa
     AND o.cod_os = b.cod_os
    LEFT JOIN notas_por_os n
      ON n.cod_empresa = b.cod_empresa
     AND n.cod_os = b.cod_os

    UNION ALL

    -- Itens de orçamentos aprovados ainda sem OS
    SELECT i.cod_empresa, NULL AS cod_os,
           'ORC:' || i.cod_empresa::text || ':' || i.guid_linha::text AS registro_id,
           NULLIF(BTRIM(i.classificacao::text), '') AS tipo,
           i.cliente, CONCAT(i.n_orcamento, i.versao) AS orcamento,
           NULL AS os, i.descricao, i.qtde::numeric AS quantidade,
           i.dt_aprovacao AS entrada_pv,
           i.dt_previsao_entrega AS entrega_acordada,
           NULL AS prev_lib_manual, i.valor,
           NULL::integer AS cod_status, 'SEM OS' AS status,
           NULL::text AS observacoes,
           n.nf, n.data_faturamento,
           (COALESCE(i.qtde, 0) > 0
            AND COALESCE(i.qtde_faturada, 0) >= i.qtde) AS faturado_total,
           FALSE AS os_concluida,
           NULL::text AS prosicao
    FROM orc_sem_os_pendentes i
    LEFT JOIN notas_por_item n
      ON n.cod_empresa = i.cod_empresa
     AND n.guid_linha = i.guid_linha
),
datas AS (
    SELECT l.*,
           COALESCE(l.prev_lib_manual::date, l.entrega_acordada::date)
               AS previsao_liberacao
    FROM linhas l
)

SELECT e.nome AS empresa,
       d.registro_id,
       d.tipo, d.cliente, d.orcamento, d.os, d.descricao,
       d.quantidade, d.entrada_pv, d.entrega_acordada, d.valor,
       d.cod_status,
       CASE
           WHEN d.faturado_total THEN 'FATURADO'
           -- OS concluída com orçamento ainda não faturado integralmente
           WHEN d.os_concluida AND NULLIF(BTRIM(d.orcamento), '') IS NOT NULL
               THEN 'FATURAMENTO'
           -- OS concluída sem orçamento permanece concluída
           WHEN d.os_concluida THEN 'CONCLUÍDO'
           WHEN d.cod_os IS NULL THEN 'SEM OS'
           ELSE d.status
       END AS status,
       d.previsao_liberacao,
       CASE
           -- Faturamento integral e conclusão prevalecem sobre as datas.
           WHEN d.faturado_total THEN 'Faturado'
           WHEN d.os_concluida AND NULLIF(BTRIM(d.orcamento), '') IS NOT NULL
               THEN 'Aguardando faturamento'
           WHEN d.os_concluida THEN 'Concluído'

           -- Orçamentos aprovados que ainda não geraram OS.
           WHEN d.cod_os IS NULL AND (
                d.entrega_acordada::date <= CURRENT_DATE OR
                d.previsao_liberacao <= CURRENT_DATE
           ) THEN 'Sem OS — Atrasado'
           WHEN d.cod_os IS NULL AND d.previsao_liberacao IS NULL
               THEN 'Sem previsão'
           WHEN d.cod_os IS NULL THEN 'Aguardando OS'

           -- OS em andamento: prazo vencido vence qualquer comparação.
           WHEN d.entrega_acordada::date <= CURRENT_DATE
             OR d.previsao_liberacao <= CURRENT_DATE
               THEN 'Prazo vencido'
           WHEN d.entrega_acordada IS NULL
             OR d.previsao_liberacao IS NULL
               THEN 'Sem previsão'
           WHEN d.previsao_liberacao > d.entrega_acordada::date
               THEN 'Avisar ao comercial'
           ELSE 'Dentro do programado'
       END AS situacao,
       EXTRACT(MONTH FROM d.previsao_liberacao)::integer AS mes,
       EXTRACT(YEAR FROM d.previsao_liberacao)::integer AS ano,
       d.observacoes, d.nf, d.data_faturamento,
       d.cod_os,
       d.prosicao AS "PROSICAO"
FROM datas d
LEFT JOIN tempresa e
  ON e.codigo = d.cod_empresa
ORDER BY d.cod_os DESC NULLS LAST, d.orcamento;