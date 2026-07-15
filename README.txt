SISTEMA CRAN — VERSÃO 1.1
Projeto Firebase: cran2026

ESTA VERSÃO
- Novo layout institucional e menos genérico.
- Tela de login dividida e responsiva.
- Identidade visual própria do CRAN.
- Menu lateral redesenhado com ícones.
- Painel com saudação, atalhos e indicadores visuais.
- Cards, tabelas, filtros e formulários reorganizados.
- Melhor adaptação para celular e computador.
- Todas as funções da versão anterior foram mantidas.

ARQUIVOS DO PACOTE
- index.html: interface principal.
- styles.css: design responsivo.
- app.js: login, pacientes, fila, profissionais, atendimentos, agenda e arquivo morto.
- firebase-config.js: conexão com o projeto cran2026.
- firestore.rules: regras para publicar pela Firebase CLI.
- firestore-rules.txt: cópia das regras para colar manualmente no Console Firebase.
- firebase.json: configuração do Firestore e Firebase Hosting.
- .firebaserc: conexão do diretório com o projeto cran2026.
- manifest.webmanifest, sw.js e ícones: instalação como aplicativo e atualização automática.
- version.json: versão publicada.

PARA TESTAR NO VS CODE
1. Extraia todos os arquivos na pasta do sistema.
2. Abra a pasta inteira no VS Code.
3. Instale a extensão Live Server.
4. Clique com o botão direito no index.html.
5. Escolha Open with Live Server.
6. Acesse pelo endereço localhost exibido pelo Live Server.

IMPORTANTE
O teste local usa o Authentication e o Firestore reais do projeto cran2026.
Não é necessário subir no GitHub para testar.

PARA ATUALIZAR A VERSÃO ANTERIOR
Substitua todos os arquivos antigos pelos arquivos deste pacote.
As coleções e os dados do Firestore não serão apagados.
As regras desta versão são compatíveis com a versão anterior.

ANTES DE ENTRAR
1. O login por E-mail/senha deve estar ativado no Firebase Authentication.
2. O administrador inicial deve existir em usuarios/UID_DO_USUARIO.
3. O documento precisa conter:
   nome: texto
   email: texto
   perfil: "admin"
   ativo: true
4. As regras do arquivo firestore-rules.txt devem estar publicadas.

COMO PUBLICAR NO FIREBASE HOSTING
1. Abra o terminal dentro da pasta.
2. Execute: firebase login
3. Execute: firebase deploy

ATUALIZAÇÃO AUTOMÁTICA
A versão atual é 1.2.2 e já está aplicada em:
- version.json
- APP_VERSION no app.js
- CACHE_NAME no sw.js
- index.html
- APP_SHELL no sw.js

SEGURANÇA
O sistema não usa Firebase Storage.
O arquivo morto mantém somente dados no Firestore.
Nunca publique arquivos de conta de serviço, private_key ou credenciais do Firebase Admin SDK.


CORREÇÃO DA INTERFACE — VERSÃO 1.2.2
=====================================
Esta versão restaura integralmente o layout profissional da versão 1.1 e adiciona o crédito sem substituir a estrutura da interface.
Crédito exibido: Sistema desenvolvido e emprestado por Eliel do Carmo.


AVISO VISÍVEL — VERSÃO 1.2.2
- Faixa fixa logo abaixo do cabeçalho em todas as telas internas.
- Crédito em alto contraste: Sistema desenvolvido e emprestado por Eliel do Carmo.
- Destaque maior também na tela de login.
- Aviso adaptado para computador e celular sem cobrir o conteúdo.
