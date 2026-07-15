SISTEMA CRAN — PRIMEIRA VERSÃO
Projeto Firebase: cran2026

ARQUIVOS DO PACOTE
- index.html: interface principal.
- styles.css: design responsivo para computador e celular.
- app.js: login, pacientes, fila, profissionais, atendimentos, agenda e arquivo morto.
- firebase-config.js: conexão com o projeto cran2026.
- firestore.rules: regras para publicar pelo Firebase CLI.
- firestore-rules.txt: cópia das regras para colar manualmente no Console Firebase.
- firebase.json: configuração do Firestore e Firebase Hosting.
- .firebaserc: conexão do diretório com o projeto cran2026.
- manifest.webmanifest, sw.js e ícones: instalação como aplicativo e atualização automática.
- version.json: número da versão publicada.

ANTES DE TESTAR
1. No Firebase Authentication, mantenha E-mail/senha ativado.
2. No Firestore, confira se o primeiro administrador está em:
   usuarios/UID_DO_USUARIO
3. O documento do primeiro administrador precisa ter:
   nome: texto
   email: texto
   perfil: "admin"
   ativo: true
4. Publique as regras do arquivo firestore-rules.txt na aba Firestore Database > Regras.

COMO TESTAR LOCALMENTE
Não abra o index.html com clique duplo, pois os módulos JavaScript precisam de um servidor.

Opção com Firebase CLI:
1. Abra o terminal dentro da pasta dos arquivos.
2. Execute: firebase login
3. Execute: firebase serve
4. Abra o endereço informado no terminal.

COMO PUBLICAR NO FIREBASE HOSTING
1. Instale o Node.js caso ainda não tenha.
2. Instale a Firebase CLI:
   npm install -g firebase-tools
3. Abra o terminal na pasta do sistema.
4. Execute:
   firebase login
5. Depois execute:
   firebase deploy

O comando firebase deploy publicará ao mesmo tempo:
- o site no Firebase Hosting;
- as regras do Cloud Firestore.

PRIMEIRA CONFIGURAÇÃO DENTRO DO SISTEMA
1. Entre com o administrador já criado.
2. Abra Profissionais e cadastre os profissionais do CRAN.
3. Abra Usuários e crie os acessos da recepção e dos profissionais.
4. Ao criar um usuário com perfil Profissional, selecione o cadastro do profissional correspondente.
5. Cadastre os pacientes.
6. Coloque os pacientes na fila.
7. Na fila, clique em Encaminhar e selecione o profissional.
8. O paciente passará a aparecer no painel do profissional vinculado.

PERFIS
Administrador:
- acesso completo;
- gerencia profissionais e usuários;
- pode cadastrar, encaminhar, agendar, concluir e restaurar pacientes.

Recepção:
- cadastra pacientes;
- gerencia a fila;
- vincula pacientes aos profissionais;
- administra agenda e arquivo morto;
- não cria usuários nem altera profissionais.

Profissional:
- vê somente pacientes atribuídos ao próprio cadastro;
- vê a própria agenda;
- registra observações operacionais;
- atualiza comparecimento;
- solicita alta para a recepção.

ATUALIZAÇÃO AUTOMÁTICA
Sempre que uma nova versão for publicada:
1. Altere o valor em version.json.
2. Altere APP_VERSION no começo de app.js.
3. Altere CACHE_NAME no começo de sw.js.
4. Atualize os sufixos ?v= no index.html e a lista APP_SHELL do sw.js.

Exemplo: trocar 1.0.0 por 1.0.1 em todos esses locais.
O sistema exibirá um aviso de nova versão sem exigir limpeza manual do cache.

OBSERVAÇÃO DE SEGURANÇA
O sistema não usa Firebase Storage. O arquivo morto mantém somente dados no Firestore.
Não publique arquivos de conta de serviço, private_key ou credenciais do Firebase Admin SDK.
