@echo off
setlocal enabledelayedexpansion
cls

:: Publishing Assistant for VS Code Extension
:: Angular Translation Extractor
:: Publisher: AdilsondeAlmeidaPedro

color 0A
echo.
echo ============================================================
echo   VS CODE EXTENSION PUBLISHING ASSISTANT
echo   Extension: Angular Translation Extractor
echo   Publisher: AdilsondeAlmeidaPedro
echo ============================================================
echo.

:: Navigate to project root
cd /d "%~dp0\.."
echo Current directory: %CD%
echo.

:MENU
cls
echo.
echo ============================================================
echo   PUBLISHING MENU
echo ============================================================
echo.
echo   1. Check Prerequisites
echo   2. Validate package.json
echo   3. Install/Update vsce
echo   4. Setup Azure DevOps PAT (Guide)
echo   5. Create Publisher Account (Guide)
echo   6. Login to Publisher
echo   7. Compile Extension
echo   8. Package Extension (.vsix)
echo   9. Publish Extension
echo   10. Publish with Version Bump (Patch/Minor/Major)
echo   11. Publish Pre-release
echo   12. Open VS Code Marketplace
echo   13. Open Publisher Management
echo   0. Exit
echo.
set /p choice="Enter your choice (0-13): "

if "%choice%"=="1" goto CHECK_PREREQ
if "%choice%"=="2" goto VALIDATE_PACKAGE
if "%choice%"=="3" goto INSTALL_VSCE
if "%choice%"=="4" goto AZURE_GUIDE
if "%choice%"=="5" goto PUBLISHER_GUIDE
if "%choice%"=="6" goto LOGIN
if "%choice%"=="7" goto COMPILE
if "%choice%"=="8" goto PACKAGE
if "%choice%"=="9" goto PUBLISH
if "%choice%"=="10" goto PUBLISH_VERSION
if "%choice%"=="11" goto PUBLISH_PRERELEASE
if "%choice%"=="12" goto OPEN_MARKETPLACE
if "%choice%"=="13" goto OPEN_MANAGEMENT
if "%choice%"=="0" goto END

echo Invalid choice. Please try again.
timeout /t 2 >nul
goto MENU

:CHECK_PREREQ
cls
echo.
echo ============================================================
echo   CHECKING PREREQUISITES
echo ============================================================
echo.

:: Check Node.js
echo [1/3] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo   [X] Node.js NOT FOUND
    echo.
    echo   Please install Node.js from: https://nodejs.org/
    color 0A
) else (
    node --version
    echo   [OK] Node.js is installed
)
echo.

:: Check npm
echo [2/3] Checking npm...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo   [X] npm NOT FOUND
    color 0A
) else (
    npm --version
    echo   [OK] npm is installed
)
echo.

:: Check vsce
echo [3/3] Checking vsce...
where vsce >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo   [X] vsce NOT FOUND
    echo.
    echo   Install vsce with: npm install -g @vscode/vsce
    echo   Or use option 3 from the menu to install it.
    color 0A
) else (
    vsce --version
    echo   [OK] vsce is installed
)
echo.

echo ============================================================
pause
goto MENU

:VALIDATE_PACKAGE
cls
echo.
echo ============================================================
echo   VALIDATING package.json
echo ============================================================
echo.

if not exist "package.json" (
    color 0C
    echo [X] package.json NOT FOUND
    color 0A
    pause
    goto MENU
)

echo Checking required fields...
echo.

:: Read and display key fields
findstr /C:"\"name\"" package.json
findstr /C:"\"displayName\"" package.json
findstr /C:"\"version\"" package.json
findstr /C:"\"publisher\"" package.json
findstr /C:"\"description\"" package.json
findstr /C:"\"engines\"" package.json

echo.
echo ============================================================
echo.
echo CHECKLIST:
echo   [ ] name is unique
echo   [ ] displayName is clear
echo   [ ] version follows semver (x.y.z)
echo   [ ] publisher is: AdilsondeAlmeidaPedro
echo   [ ] description is comprehensive
echo   [ ] engines.vscode version is correct
echo   [ ] icon path exists
echo   [ ] repository URL is set
echo   [ ] license field is set
echo.
echo ============================================================
pause
goto MENU

:INSTALL_VSCE
cls
echo.
echo ============================================================
echo   INSTALLING/UPDATING VSCE
echo ============================================================
echo.
echo Installing @vscode/vsce globally...
echo.

npm install -g @vscode/vsce

if %errorlevel% equ 0 (
    echo.
    echo [OK] vsce installed successfully
    echo.
    vsce --version
) else (
    color 0C
    echo.
    echo [X] Failed to install vsce
    color 0A
)

echo.
echo ============================================================
pause
goto MENU

:AZURE_GUIDE
cls
echo.
echo ============================================================
echo   AZURE DEVOPS PAT SETUP GUIDE
echo ============================================================
echo.
echo Follow these steps to create a Personal Access Token:
echo.
echo 1. Go to: https://dev.azure.com
echo.
echo 2. Click on "Start free" (if no account)
echo.
echo 3. Sign in with:
echo    - Microsoft Account (Outlook, Hotmail, etc.)
echo    - GitHub Account
echo    - Or create new account
echo.
echo 4. After login, click your profile icon (top right)
echo.
echo 5. Select "Personal access tokens"
echo.
echo 6. Click "+ New Token"
echo.
echo 7. Configure token:
echo    - Name: "VS Code Extension Publishing"
echo    - Organization: "All accessible organizations"
echo    - Expiration: 90 days (or custom)
echo    - Scopes: Click "Show all scopes"
echo    - Find "Marketplace" section
echo    - Check "Manage" (IMPORTANT!)
echo.
echo 8. Click "Create"
echo.
echo 9. COPY THE TOKEN (you won't see it again!)
echo.
echo 10. Save it securely (use password manager)
echo.
echo ============================================================
echo.
set /p open="Open Azure DevOps now? (Y/N): "
if /i "%open%"=="Y" start https://dev.azure.com
echo.
pause
goto MENU

:PUBLISHER_GUIDE
cls
echo.
echo ============================================================
echo   PUBLISHER ACCOUNT SETUP GUIDE
echo ============================================================
echo.
echo Follow these steps to create a Publisher account:
echo.
echo 1. Go to: https://marketplace.visualstudio.com/manage
echo.
echo 2. Sign in with the SAME ACCOUNT as Azure DevOps
echo.
echo 3. Click "Create publisher" (if first time)
echo.
echo 4. Fill in details:
echo    - Publisher ID: AdilsondeAlmeidaPedro
echo    - Display name: Adilson de Almeida Pedro (or your name)
echo    - Description: Brief description
echo.
echo 5. Click "Create"
echo.
echo 6. Verify the publisher ID matches package.json:
echo    "publisher": "AdilsondeAlmeidaPedro"
echo.
echo ============================================================
echo.
set /p open="Open Marketplace Management now? (Y/N): "
if /i "%open%"=="Y" start https://marketplace.visualstudio.com/manage
echo.
pause
goto MENU

:LOGIN
cls
echo.
echo ============================================================
echo   LOGIN TO PUBLISHER ACCOUNT
echo ============================================================
echo.
echo Publisher: AdilsondeAlmeidaPedro
echo.
echo You will be prompted for your Azure DevOps PAT.
echo Make sure you have created it using option 4.
echo.
set /p confirm="Ready to login? (Y/N): "
if /i not "%confirm%"=="Y" goto MENU

echo.
echo Running: vsce login AdilsondeAlmeidaPedro
echo.

vsce login AdilsondeAlmeidaPedro

if %errorlevel% equ 0 (
    echo.
    echo [OK] Login successful!
) else (
    color 0C
    echo.
    echo [X] Login failed
    echo.
    echo Possible issues:
    echo   - PAT token is incorrect
    echo   - PAT doesn't have "Marketplace (Manage)" scope
    echo   - PAT expired
    echo   - Wrong publisher ID
    echo.
    echo Create a new PAT using option 4 from the menu.
    color 0A
)

echo.
echo ============================================================
pause
goto MENU

:COMPILE
cls
echo.
echo ============================================================
echo   COMPILING EXTENSION
echo ============================================================
echo.
echo Running: npm run compile
echo.

npm run compile

if %errorlevel% equ 0 (
    echo.
    echo [OK] Compilation successful!
) else (
    color 0C
    echo.
    echo [X] Compilation failed
    echo.
    echo Please fix TypeScript errors before publishing.
    color 0A
)

echo.
echo ============================================================
pause
goto MENU

:PACKAGE
cls
echo.
echo ============================================================
echo   PACKAGING EXTENSION
echo ============================================================
echo.
echo This will create a .vsix file for local testing.
echo.

:: Compile first
echo [1/2] Compiling...
call npm run compile

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [X] Compilation failed. Fix errors first.
    color 0A
    pause
    goto MENU
)

echo.
echo [2/2] Packaging...
echo.

vsce package

if %errorlevel% equ 0 (
    echo.
    echo [OK] Package created successfully!
    echo.
    echo To test installation:
    dir /b *.vsix
    echo.
    set /p vsix="Enter .vsix filename to test install (or press Enter to skip): "
    if not "!vsix!"=="" (
        echo.
        echo Installing: !vsix!
        code --install-extension !vsix!
        echo.
        echo Extension installed. Restart VS Code to test.
    )
) else (
    color 0C
    echo.
    echo [X] Packaging failed
    color 0A
)

echo.
echo ============================================================
pause
goto MENU

:PUBLISH
cls
echo.
echo ============================================================
echo   PUBLISHING EXTENSION
echo ============================================================
echo.
echo This will publish to VS Code Marketplace.
echo.
echo Current version in package.json:
findstr /C:"\"version\"" package.json
echo.
echo WARNING: This will make your extension publicly available!
echo.
set /p confirm="Proceed with publishing? (Y/N): "
if /i not "%confirm%"=="Y" goto MENU

echo.
echo [1/3] Compiling...
call npm run compile

if %errorlevel% neq 0 (
    color 0C
    echo [X] Compilation failed
    color 0A
    pause
    goto MENU
)

echo.
echo [2/3] Running pre-publish validation...
echo.

:: Check if logged in
vsce ls 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [X] Not logged in. Use option 6 to login first.
    color 0A
    pause
    goto MENU
)

echo.
echo [3/3] Publishing...
echo.

vsce publish

if %errorlevel% equ 0 (
    color 0E
    echo.
    echo ============================================================
    echo   [SUCCESS] EXTENSION PUBLISHED!
    echo ============================================================
    echo.
    echo Your extension is now available on VS Code Marketplace.
    echo.
    echo View it at:
    echo https://marketplace.visualstudio.com/items?itemName=AdilsondeAlmeidaPedro.angular-tanslation-extractor
    echo.
    echo Manage at:
    echo https://marketplace.visualstudio.com/manage/publishers/AdilsondeAlmeidaPedro
    echo.
    set /p open="Open marketplace page? (Y/N): "
    if /i "!open!"=="Y" start https://marketplace.visualstudio.com/items?itemName=AdilsondeAlmeidaPedro.angular-tanslation-extractor
    color 0A
) else (
    color 0C
    echo.
    echo [X] Publishing failed
    color 0A
)

echo.
echo ============================================================
pause
goto MENU

:PUBLISH_VERSION
cls
echo.
echo ============================================================
echo   PUBLISH WITH VERSION BUMP
echo ============================================================
echo.
echo Current version:
findstr /C:"\"version\"" package.json
echo.
echo Select version bump type:
echo   1. Patch (0.0.1 -> 0.0.2) - Bug fixes
echo   2. Minor (0.0.1 -> 0.1.0) - New features
echo   3. Major (0.0.1 -> 1.0.0) - Breaking changes
echo   0. Cancel
echo.
set /p vtype="Enter choice (0-3): "

if "%vtype%"=="0" goto MENU
if "%vtype%"=="1" set "bump=patch"
if "%vtype%"=="2" set "bump=minor"
if "%vtype%"=="3" set "bump=major"

if not defined bump (
    echo Invalid choice
    timeout /t 2 >nul
    goto PUBLISH_VERSION
)

echo.
echo Will publish with %bump% version bump.
echo.
set /p confirm="Proceed? (Y/N): "
if /i not "%confirm%"=="Y" goto MENU

echo.
echo [1/2] Compiling...
call npm run compile

if %errorlevel% neq 0 (
    color 0C
    echo [X] Compilation failed
    color 0A
    pause
    goto MENU
)

echo.
echo [2/2] Publishing with %bump% bump...
echo.

vsce publish %bump%

if %errorlevel% equ 0 (
    color 0E
    echo.
    echo [SUCCESS] Extension published with %bump% version bump!
    echo.
    echo New version:
    findstr /C:"\"version\"" package.json
    color 0A
) else (
    color 0C
    echo.
    echo [X] Publishing failed
    color 0A
)

echo.
echo ============================================================
pause
goto MENU

:PUBLISH_PRERELEASE
cls
echo.
echo ============================================================
echo   PUBLISH PRE-RELEASE VERSION
echo ============================================================
echo.
echo This will publish a pre-release version for testing.
echo.
echo Current version:
findstr /C:"\"version\"" package.json
echo.
echo Pre-release versions use odd minor numbers (0.3, 0.5, 1.1)
echo.
set /p confirm="Proceed with pre-release? (Y/N): "
if /i not "%confirm%"=="Y" goto MENU

echo.
echo [1/2] Compiling...
call npm run compile

if %errorlevel% neq 0 (
    color 0C
    echo [X] Compilation failed
    color 0A
    pause
    goto MENU
)

echo.
echo [2/2] Publishing pre-release...
echo.

vsce publish --pre-release

if %errorlevel% equ 0 (
    color 0E
    echo.
    echo [SUCCESS] Pre-release published!
    color 0A
) else (
    color 0C
    echo.
    echo [X] Publishing failed
    color 0A
)

echo.
echo ============================================================
pause
goto MENU

:OPEN_MARKETPLACE
cls
echo.
echo Opening VS Code Marketplace...
start https://marketplace.visualstudio.com/vscode
echo.
timeout /t 2 >nul
goto MENU

:OPEN_MANAGEMENT
cls
echo.
echo Opening Publisher Management...
start https://marketplace.visualstudio.com/manage/publishers/AdilsondeAlmeidaPedro
echo.
timeout /t 2 >nul
goto MENU

:END
cls
echo.
echo ============================================================
echo   Thank you for using Publishing Assistant!
echo ============================================================
echo.
echo For detailed information, see:
echo   - docs\PUBLISHING.md
echo   - docs\PUBLISHING_CHECKLIST.md
echo.
echo Good luck with your extension!
echo.
timeout /t 3 >nul
exit /b 0
