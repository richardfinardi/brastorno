# Controle de Fábrica — implantação API

O site usa a consulta SQL já publicada em **GET /controle_fabrica** e autenticação CPS existente de **POST /producao/login**. A aplicação fica inicialmente em **/brastorno/controle_fabrica/**. O `index.html` original e `/demo/` não são alterados.

## Habilitar identidade/permissões no servidor

1. Copiar `controle_fabrica_perfil.py` para a mesma pasta em que estão `auth.py` e `conexao.py`.
2. Na sua aplicação FastAPI, adicionar:

```python
from controle_fabrica_perfil import router as controle_fabrica_router
app.include_router(controle_fabrica_router)
```

3. Reiniciar o serviço e confirmar `GET /controle_fabrica/perfil` e `GET /controle_fabrica/dados` com header `Authorization: Bearer <token>`. O frontend só utiliza **/controle_fabrica/dados**, filtrado pelo servidor. Sem essas rotas, não carrega dados.
4. Garantir que o arquivo `controle_fabrica.sql` esteja na pasta `sql/` ao lado da API; alternativamente configurar `SQL_DIR` para apontar para a pasta SQL. A busca ignora diferenças entre maiúsculas e minúsculas.
5. **Histórico sob demanda (somente U_GESTOR):** copiar `controle_fabrica_historico.sql` **ao lado de `controle_fabrica_perfil.py`**, **nunca** para `sql/`, pois ali viraria endpoint automático sem a proteção gerencial. Instalar também a versão atualizada de `controle_fabrica_perfil.py` e reiniciar a API.
6. Confirmar `GET /controle_fabrica/historico` com Bearer do gestor (200) e de outro usuário (403). A página carrega apenas pendentes por padrão; o gestor marca **Exibir concluídos e faturados** para chamar a rota do histórico uma vez, sob demanda.

As permissões são lidas da tabela `CSENHA`, empresa 1: `U_GESTOR, U_ENG, U_PCP, U_COMPRAS, U_PROD, U_CQ, U_FAT, U_EXP`.

## IMPORTANTE: segurança do endpoint de dados

**Não basta esconder abas no navegador.** A rota dedicada `GET /controle_fabrica/dados` já recebe/valida o Bearer e filtra, *no servidor*, as linhas conforme `COD_STATUS`. **Também proteja ou restrinja a rota automática `GET /controle_fabrica`** para impedir bypass direto da segurança; a aplicação nova não a utiliza. Para U_GESTOR, todos os registros. Para outros, apenas os status liberados. Ao habilitar as rotas de movimentação, validar novamente as permissões.

| Perfil | Código permitido |
| --- | --- |
| U_ENG | 6 |
| U_PCP | 7 |
| U_COMPRAS | 8 |
| U_PROD | 9 |
| U_CQ | 10 |
| U_FAT | 11 |
| U_EXP | 12 |
| U_GESTOR | Todos, inclusive 13/14/15 |

Para dados sem OS/status, exibir somente ao U_GESTOR até definição de fila de responsabilidade.

## Solicitações Kanban (preparado no frontend; sem gravação até existir API)

- `POST /controle_fabrica/solicitacoes`: registra pedido e mantém `TOS` inalterada.
- `GET /controle_fabrica/solicitacoes?status=PENDENTE`: somente U_GESTOR pode ver.
- `POST /controle_fabrica/solicitacoes/{id}/aprovar`: deve fazer transação validando status original, atualizar **COD_STATUS** e **STATUS_SERVICO** juntos na `TOS`, anexar log em observações, marcar pedido como aprovado.
- `POST /controle_fabrica/solicitacoes/{id}/rejeitar`: registra rejeição sem alterar `TOS`.

**Essas quatro rotas ainda precisam ser implementadas no serviço.** A interface impede alteração local e não relata sucesso caso o backend não confirme.

## Observação

`auth.py` original foi mantido sem alteração. A nova rota usa `obter_usuario_logado` para validar o token e busca as permissões atuais diretamente no banco.

Configure uma `SECRET_KEY` exclusiva via variável de ambiente no serviço; evite a chave padrão publicada no código.

## Integração do STATUS AUTOMÁTICO — V4 (13/10/2026)

O aplicativo oficial agora está na **raiz** do repositório (`/index.html`).
O arquivo `controle_fabrica/index.html` apenas redireciona para a raiz.

O usuário **validou a SQL V4 no PostgreSQL**: 620 OS e retorno instantâneo. A UI exibe o indicador
em coluna própria **STATUS AUTOMÁTICO**, pesquisa/filtro múltiplo, detalhes, cartões e CSV,
sem substituir a coluna **STATUS CPS** e sem acionar movimentações.

### Instalação na API monolítica que está rodando em C:\\api-dados

1. Fazer backup de `C:\\api-dados\\api.py`.
2. Substituir pelo `api.py` **completo**, com o novo endpoint protegido
   `GET /controle_fabrica/status_automatico`. O arquivo deve preservar as rotas
   existentes, inclusive o SQL dinâmico de `sql/` e a rota de histórico.
3. Colocar `controle_fabrica_status_automatico.sql` **junto do api.py**, em
   `C:\\api-dados\\controle_fabrica_status_automatico.sql`; **não colocar em `sql/`**,
   para não tornar a consulta acessível pelo endpoint dinâmico público.
4. Reiniciar Uvicorn e verificar `/docs`, procurando `GET /controle_fabrica/status_automatico`.
5. Confirmar que requer token e que os funcionários só recebem OS dos próprios perfis CPS.
6. Na aplicação, clicar **Atualizar** e conferir o selo com a quantidade de OS analisadas.

O status automático vem da SQL V4 em separado por `REGISTRO_ID = OS:<empresa>:<codigo_os>`.
Orçamentos sem OS e serviços fora do universo ativo da V4 aparecem como `—` (sem cálculo),
nunca como status inventado. A API aplica as permissões via `COD_STATUS` incluído na SQL.
A consulta não faz `UPDATE`, não altera status manual e não libera dados de outros perfis.

**Atenção à versão da API:** as instruções antigas deste documento referentes a
`controle_fabrica_perfil.py` descreviam uma implementação por módulo separado.
Na instalação atual de `api.py` monolítico as rotas já pertencem ao arquivo principal:
não é necessário cadastrar um segundo router.
