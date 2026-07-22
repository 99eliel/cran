SISTEMA CRAN v1.8.0 — OTIMIZAÇÃO DE LEITURAS E COMPATIBILIDADE

ESTRATÉGIA DESTA VERSÃO
- Não depender de índices compostos nas funções principais.
- Carregar somente o período visível na agenda da administração/recepção.
- Para o profissional, carregar somente documentos vinculados ao profissional e usar cache temporário.
- Arquivo morto limitado a 50 resultados por página.
- Pesquisas do arquivo morto usam um único campo no Firestore e refinam os demais filtros localmente.
- Relatórios só consultam dados quando o usuário clicar em Gerar relatório.
- Dashboard reutiliza a fila carregada para calcular urgências e especialidades.
- Verificações de CPF, prontuário e conflitos usam consultas exatas e limitadas.
- Importação histórica continua usando marcador único de migração.

PUBLICAÇÃO
Não é necessário publicar índices compostos.
Use:

firebase deploy --only hosting

ou, para publicar também as regras:

firebase deploy

CACHE
O botão Atualizar limpa o cache temporário em memória e busca os dados novamente.
