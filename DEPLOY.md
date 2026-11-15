# Публикация HR POTOK

Сайт публикуется через GitHub Pages, а входы, голоса и результаты синхронизируются через Firebase. Публикация страниц сама по себе не переносит тестовые данные эмулятора в настоящую базу.

## 1. Создайте пустой репозиторий GitHub

1. На GitHub нажмите **+ → New repository**.
2. Укажите имя `hr-potok`, выберите **Public** и создайте репозиторий без README, лицензии и `.gitignore`.
3. В новом репозитории откройте **Settings → Secrets and variables → Actions → Variables**. Нажмите **New repository variable** и добавьте эти значения из `.env.local`:

   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_DATABASE_URL`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`

   Firebase Web-конфигурация попадёт в опубликованный код и не является паролем. Не добавляйте сюда пароль ведущего, Firebase Admin SDK key или файл сервисного аккаунта.

4. На странице репозитория откройте **Settings → Pages**. В поле **Build and deployment → Source** выберите **GitHub Actions**.

## 2. Отправьте файлы из VS Code

Откройте терминал VS Code в папке `hr-potok` и выполните по одной команде:

```powershell
git init
git add .
git status --short
```

Убедитесь, что в списке нет `.env.local`, `node_modules`, `.emulator-data` и `firebase-export-*`. Они уже добавлены в `.gitignore`. Если `.env.local` всё же отображается, не выполняйте следующие команды.

Замените `ВАШ_ЛОГИН` на имя своего GitHub-аккаунта:

```powershell
git commit -m "Publish HR POTOK"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/hr-potok.git
git push -u origin main
```

Если GitHub попросит авторизоваться, завершите вход в открывшемся окне браузера.

## 3. Дождитесь сайта

В репозитории откройте вкладку **Actions**, выберите запуск **Build and publish HR POTOK** и дождитесь зелёной отметки. Адрес игры будет:

`https://ВАШ_ЛОГИН.github.io/hr-potok/`

Страницы будут доступны по адресам `/participant`, `/admin` и `/screen`; QR-код на экране ведёт на опубликованный адрес участника.

## 4. Подключите настоящий Firebase

1. В Firebase Console откройте **Authentication → Settings → Authorized domains** и добавьте домен `ВАШ_ЛОГИН.github.io` (без `https://` и без `/hr-potok`). Включите способы входа **Anonymous** и **Email/Password**.
2. В корне проекта выполните `npx firebase login`, войдите в Google-аккаунт владельца Firebase-проекта, затем выполните `npm run deploy:functions`.
3. Cloud Functions требует Firebase-план Blaze с подключённым биллингом. Перед включением настройте бюджетные уведомления; фактическая стоимость зависит от использования.
4. Добавьте UID аккаунта ведущего в настоящую Realtime Database по пути `admins/UID` со значением boolean `true`.
5. До публикации правил сначала остановите обычные эмуляторы (`Ctrl+C` в их терминале), затем в VS Code выполните `npm run verify:emulators`. Эта отдельная проверка запускает временные эмуляторы, проверяет сохранение имени, принятие только одного корректного голоса, запрет прямого доступа к голосам и появление итогов после команды ведущего, после чего сама закрывает временные эмуляторы. Если все проверки пройдены, выполните `npm run deploy:rules`. Старые правила в Firebase Console не совпадают с текущей структурой игры. Не заменяйте их открытыми правилами.

После изменения файлов и нового `git push` сайт публикуется автоматически. Список подготовленных вопросов хранится в браузере и будет отдельным на `localhost` и на опубликованном GitHub Pages адресе; подготовьте его на том адресе и компьютере, с которого будете вести конференцию.
