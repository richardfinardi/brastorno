# BRASTORNO — ajustes de tipo e status CPS (23/10/2026)

## Instalação no servidor C:\\api-dados

1. Faça backup de `C:\\api-dados\\api.py`.
2. Copie `controle_fabrica_ajustes.py` desta pasta para `C:\\api-dados\\controle_fabrica_ajustes.py`.
3. No arquivo `C:\\api-dados\\api.py`, **após** a linha que cria `app = FastAPI(...)`, acrescente:

```python
from controle_fabrica_ajustes import router as controle_fabrica_ajustes_router
app.include_router(controle_fabrica_ajustes_router)
```

4. Reinicie a API e atualize a página com **Ctrl+F5**.

## Mudanças

- TST_SERV: carregamento do cadastro completo da empresa 1, sem lista fixa de códigos.
- Status da OS: gestor grava em TOS.COD_STATUS e TOS.STATUS_SERVICO, inclusive em concluídas. Conferência transacional da alteração, registro em TOS.U_HIST e cancelamento de solicitações pendentes anteriores.
- Status de item sem OS: grava em TORCAMENTO_ITENS.STRING1.
- Classificação: gravação e verificação em TOS e TORCAMENTO vinculado.
- O status operacional derivado "Aguardando faturamento" é independente do **STATUS CPS oficial** mostrado na coluna, preservando o acompanhamento de orçamentos pendentes.
- SQL dinâmico e demais endpoints existentes não são alterados.
