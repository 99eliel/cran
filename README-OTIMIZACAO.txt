SISTEMA CRAN v1.7.1 — OTIMIZAÇÃO DE LEITURAS

PRINCIPAIS MUDANÇAS
- Arquivo morto: 50 documentos por página usando cursor do Firestore.
- Dashboard: contagens agregadas em vez de baixar coleções completas.
- Agenda: consulta somente o dia, semana ou mês visível.
- Relatórios: nenhuma consulta pesada ao abrir a aba; os dados são lidos apenas ao clicar em Gerar relatório.
- Conflitos de agenda: consulta apenas o horário escolhido.
- Verificação de CPF e duplicidade: consultas exatas e limitadas.
- Importação histórica: usa um documento marcador, evitando ler todo o arquivo morto para conferir duplicidades.
- Cache curto em memória para profissionais e consultas repetidas.

PUBLICAÇÃO
Execute: firebase deploy
O firebase.json agora também publica firestore.indexes.json. Alguns índices podem levar alguns minutos para terminar de construir no primeiro deploy.

IMPORTANTE
Use o botão Atualizar do sistema quando precisar ignorar o cache curto e buscar os dados novamente.
