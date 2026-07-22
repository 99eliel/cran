SISTEMA CRAN — VERSÃO 1.8.0
Projeto Firebase: cran2026

PRINCIPAIS MÓDULOS
- Login e perfis de acesso.
- Pacientes e fila de espera.
- Encaminhamento para profissionais.
- Pacientes em atendimento.
- Agenda diária, semanal e mensal.
- Relatórios com filtros, CSV e impressão/PDF.
- Profissionais e usuários.
- Arquivo morto, importação histórica, cadastro manual e restauração.
- PWA instalável com atualização automática.

NOVIDADES DA VERSÃO 1.8.0
- Correção dos erros “The query requires an index”.
- Painel refeito sem consultas compostas.
- Agenda reestruturada para funcionar sem índice composto.
- Arquivo morto reestruturado com paginação de 50 registros.
- Filtros volumosos usam somente um campo por consulta e refinamento local.
- Encaminhamento, atendimento e conflito de horários revisados.
- firebase.json não exige publicação de índices compostos.
- Cache e carregamento sob demanda mantidos para reduzir leituras.

ARQUIVO MORTO
- Exibe até 50 registros por página.
- Busca por início do nome, prontuário exato ou telefone exato.
- Filtro por origem e especialidade.
- Cadastro manual disponível para administração e recepção.
- Importação histórica disponível somente para administrador.
- Exportação da página atual em CSV.
- Restauração de prontuários antigos.

IMPORTANTE SOBRE O ARQUIVO HISTÓRICO
O arquivo arquivo-morto-cran.json contém dados pessoais e informações de saúde.
NÃO coloque esse JSON no GitHub ou na pasta pública do Hosting.
Guarde o pacote de migração em local privado.

TESTAR NO VS CODE
1. Extraia todos os arquivos na mesma pasta.
2. Abra a pasta inteira no VS Code.
3. Abra index.html com Live Server.
4. Use localhost no navegador.
5. Pressione Ctrl + Shift + R após substituir uma versão.
6. Se necessário: F12 > Application > Storage > Clear site data.

PUBLICAR NO FIREBASE HOSTING
1. Abra o terminal dentro da pasta.
2. Execute: firebase login
3. Execute: firebase use cran2026
4. Execute: firebase deploy --only hosting

Para publicar também as regras do Firestore:
- Execute: firebase deploy

Não é necessário executar firebase deploy --only firestore:indexes.

ARQUIVOS PRINCIPAIS
- index.html: interface.
- styles.css: design responsivo.
- app.js: funções do sistema.
- firebase-config.js: conexão com cran2026.
- firestore.rules e firestore-rules.txt: regras de segurança.
- firebase.json e .firebaserc: publicação.
- manifest.webmanifest, sw.js e ícones: PWA.
- version.json: controle de atualização.

SEGURANÇA
- Não utiliza Firebase Storage.
- O arquivo morto armazena somente dados no Firestore.
- Nunca publique conta de serviço, private_key ou credenciais do Firebase Admin SDK.
