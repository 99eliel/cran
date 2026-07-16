SISTEMA CRAN — VERSÃO 1.5.0
Projeto Firebase: cran2026

PRINCIPAIS MÓDULOS
- Login e perfis de acesso.
- Pacientes e fila de espera.
- Encaminhamento para profissionais.
- Pacientes em atendimento.
- Agenda diária, semanal e mensal.
- Relatórios com filtros e exportação.
- Profissionais e usuários.
- Arquivo morto com restauração de pacientes.
- PWA instalável e atualização automática.

NOVIDADES DA VERSÃO 1.5.0 — MIGRAÇÃO DO ARQUIVO MORTO
- Importação privada do cadastro histórico em JSON.
- Importação disponível somente para o administrador.
- Verificação automática para impedir registros duplicados ao repetir a importação.
- Processamento em lotes para respeitar os limites do Firestore.
- Progresso visual durante toda a importação.
- Busca por nome, número do prontuário, condição, atendimento e telefone.
- Filtros por origem e especialidade.
- Paginação de 100 registros por tela.
- Exportação do arquivo morto em CSV.
- Preservação do texto original do documento antigo.
- Terapia Ocupacional, Equoterapia e Grupo permanecem como categorias históricas.
- Ao restaurar um prontuário antigo, o paciente volta com “Cadastro incompleto” e deve ser atualizado antes de entrar na fila.

IMPORTANTE SOBRE OS DADOS HISTÓRICOS
O arquivo arquivo-morto-cran.json é confidencial e contém dados pessoais e informações de saúde.
NÃO coloque esse JSON no GitHub.
NÃO coloque esse JSON dentro da pasta publicada pelo Firebase Hosting.
Guarde o pacote de migração em uma pasta privada no computador.

COMO IMPORTAR
1. Atualize o sistema com os arquivos desta versão.
2. Teste pelo Live Server no VS Code.
3. Entre no sistema usando o administrador.
4. Abra “Arquivo morto”.
5. Clique em “Importar histórico”.
6. Selecione o arquivo arquivo-morto-cran.json do pacote privado de migração.
7. Confira a quantidade mostrada na prévia.
8. Clique em “Iniciar importação”.
9. Mantenha a página aberta até aparecer a mensagem de conclusão.

A importação pode ser repetida com segurança. Os identificadores são determinísticos e os registros já existentes serão ignorados.

PARA TESTAR NO VS CODE
1. Extraia todos os arquivos do sistema na mesma pasta.
2. Abra a pasta inteira no VS Code.
3. Instale a extensão Live Server.
4. Clique com o botão direito no index.html.
5. Escolha Open with Live Server.
6. Acesse pelo endereço localhost exibido.

O teste local usa o Authentication e o Firestore reais do projeto cran2026.
Não é necessário subir no GitHub para testar.

PARA PUBLICAR NO FIREBASE HOSTING
1. Abra o terminal dentro da pasta.
2. Execute: firebase login
3. Execute: firebase deploy

ARQUIVOS DO SISTEMA
- index.html: interface principal.
- styles.css: design responsivo.
- app.js: regras e funções do sistema.
- firebase-config.js: conexão com o projeto cran2026.
- firestore.rules: regras do Firestore.
- firestore-rules.txt: cópia das regras para colar no console.
- firebase.json e .firebaserc: configuração de publicação.
- manifest.webmanifest, sw.js e ícones: PWA e atualização automática.
- version.json: versão publicada.

SEGURANÇA
- O sistema não utiliza Firebase Storage.
- O arquivo morto armazena somente dados no Firestore.
- Nunca publique conta de serviço, private_key ou credenciais do Firebase Admin SDK.
- O arquivo de migração não faz parte do ZIP do sistema e deve continuar privado.
