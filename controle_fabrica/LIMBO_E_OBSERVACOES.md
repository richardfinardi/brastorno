# Limbo e observações — Brastorno (13/10/2026)

**Novos campos do CPS:** `TOS.U_LIMBO` e `TORCAMENTO.U_LIMBO`, representando `1` (limbo) e `0` (ativo).

## Funcionamento
- Somente `U_GESTOR` consegue enviar ou retirar registros do Limbo, individualmente ou em lote.
- Ao enviar/restaurar uma OS, a API percorre os relacionamentos por `TORCAMENTO_ITENS -> TSOL_MAX_OS -> TOS_SOLICITACAO_NECESSIDADE` e sincroniza os orçamentos e demais OS relacionados.
- O serviço é removido dos dados ativos, status automáticos, histórico de concluídos e fila de aprovação. Consequentemente, não aparece nos KPIs, na tabela, nos gráficos ou no Kanban.
- A aba **Limbo** é exclusiva do gestor; lista OS e orçamentos sem OS, permite pesquisa e restauração individual/em lote.
- Grava uma linha de auditoria em `TOS.OBS` quando uma OS entra/sai do Limbo.
- Usuários autorizados ao estágio da OS podem escrever observações, sem permissão para editar tipo/prazo/status.
- A movimentação pendente no Kanban tem botão **Justificar movimentação** para o solicitante ou gestor. A justificativa é imediatamente anexada ao histórico `TOS.OBS` e permanece na solicitação SQLite; não é duplicada na aprovação.

## Implantação
Copiar o `api.py` do pacote entregue ao diretório `C:\api-dados\api.py`, após backup, e reiniciar o Uvicorn pelo .BAT da Brastorno. Não mover/excluir a pasta `sql/` nem os arquivos SQL históricos e automáticos da raiz. O frontend é o `index.html` da raiz do repositório.

Confirmar no `/docs` as rotas protegidas:
- `GET /controle_fabrica/limbo`
- `POST /controle_fabrica/limbo`
- `POST /controle_fabrica/solicitacoes/{id}/observacao`
- `POST /controle_fabrica/os/{cod_os}/observacoes`

## Segurança
Apenas JWT não basta: a API consulta `CSENHA` e valida `U_GESTOR` no servidor, bloqueando alteração e leitura do Limbo para outros perfis. Comentários só para usuários autorizados ao setor, gestor ou solicitante da movimentação.

## Teste recomendado
1. Enviar uma OS sem orçamento ao Limbo e conferir todos os painéis.
2. Enviar um orçamento sem OS ao Limbo e conferir o desaparecimento de todos os seus itens.
3. Enviar OS com orçamento ao Limbo, validar ambas as flags e restaurar.
4. Tentar `GET/POST /limbo` com usuário não gestor: deve retornar 403.
5. Com usuário de setor, adicionar comentário em OS autorizada e justificar movimento pendente; consultar o histórico no CPS.

**Atenção:** alterações não foram testadas contra o banco de produção. Antes de uso em lote, conferir os campos novos e usar um registro de teste.
