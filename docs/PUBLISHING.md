# Publishing Angular Translation Extractor to VS Code Marketplace

This guide explains how to package and publish the **Angular Translation Extractor** extension to the Visual Studio Code Marketplace.

## Extension Details

- **Extension Name**: `angular-tanslation-extractor`
- **Display Name**: Angular Translation Extractor
- **Publisher**: AdilsondeAlmeidaPedro
- **Current Version**: 0.0.1
- **VS Code Engine**: ^1.85.0

---

## Prerequisites

Before publishing, ensure you have:

1. **Node.js** installed (already required for development)
2. **vsce** (Visual Studio Code Extensions) CLI tool
3. An **Azure DevOps** account (free)
4. A **Personal Access Token** (PAT) from Azure DevOps
5. A **Publisher account** on VS Code Marketplace

---

## Step 1: Install vsce

Install the vsce command-line tool globally:

```bash
npm install -g @vscode/vsce
```

Verify installation:

```bash
vsce --version
```

---

## Step 2: Create Azure DevOps Account & Personal Access Token

### 2.1 Create Azure DevOps Organization

1. Go to [Azure DevOps Portal](https://dev.azure.com)
2. Sign in with your Microsoft account (or create one)
3. Click **+ New organization** or follow the [Create an organization guide](https://learn.microsoft.com/azure/devops/organizations/accounts/create-organization)
4. Follow the prompts to create your organization

### 2.2 Generate Personal Access Token (PAT)

1. In Azure DevOps, click your **profile icon** (top right)
2. Select **Personal access tokens**
3. Click **+ New Token**
4. Configure the token:
   - **Name**: VS Code Extension Publishing (or any name)
   - **Organization**: **All accessible organizations**
   - **Expiration**: Set desired expiration (recommend 90-365 days)
   - **Scopes**: Select **Custom defined**
     - Click **Show all scopes**
     - Scroll to **Marketplace** section
     - Check **Manage** (this gives publish/unpublish permissions)
5. Click **Create**
6. **IMPORTANT**: Copy the token immediately and store it securely (you won't see it again!)

⚠️ **Common Mistakes**:
- Selecting a specific organization instead of "All accessible organizations"
- Not selecting the "Marketplace (Manage)" scope
- Losing the token after creation (store it in a password manager)

---

## Step 3: Create a Publisher

### 3.1 Create Publisher on Marketplace

1. Go to [Visual Studio Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
2. Sign in with the **same Microsoft account** used for Azure DevOps
3. Click **Create publisher**
4. Fill in the required fields:
   - **ID**: `AdilsondeAlmeidaPedro` (must match `package.json` publisher field)
   - **Name**: Your display name (e.g., "Adilson de Almeida Pedro")
   - **Email**: adilson@almeidapedro.com.br
   - **Website** (optional): https://adilson.almeidapedro.com.br
5. Click **Create**

### 3.2 Verify Publisher with vsce

In your terminal, authenticate vsce with your publisher:

```bash
vsce login AdilsondeAlmeidaPedro
```

When prompted, paste your **Personal Access Token**.

Expected output:
```
Personal Access Token for publisher 'AdilsondeAlmeidaPedro': ****
The Personal Access Token verification succeeded for the publisher 'AdilsondeAlmeidaPedro'.
```

---

## Step 4: Prepare Extension for Publishing

### 4.1 Update package.json

Ensure your `package.json` has all required fields:

```json
{
  "name": "angular-tanslation-extractor",
  "displayName": "Angular Translation Extractor",
  "description": "Extracts Angular app strings from JS/TS/HTML, generates per-file locale JSONs and translation loader artifacts.",
  "version": "0.0.1",
  "publisher": "AdilsondeAlmeidaPedro",
  "icon": "assets/angular.ico",
  "author": {
    "name": "Adilson de Almeida Pedro",
    "email": "adilson@almeidapedro.com.br"
  },
  "license": "SEE LICENSE IN LICENSE",
  "repository": {
    "type": "git",
    "url": "https://github.com/devremoto/YOUR-REPO-NAME"
  },
  "bugs": {
    "url": "https://github.com/devremoto/YOUR-REPO-NAME/issues"
  },
  "homepage": "https://github.com/devremoto/YOUR-REPO-NAME#readme",
  "keywords": [
    "angular",
    "i18n",
    "translation",
    "internationalization",
    "localization",
    "extract",
    "translate"
  ],
  "categories": [
    "Programming Languages"
  ]
}
```

⚠️ **Note**: Update repository URLs with your actual GitHub repository.

### 4.2 Required Files

Ensure these files exist in your project root:

- ✅ **README.md** - Extension documentation (will appear on Marketplace)
- ✅ **LICENSE** - License information
- ✅ **CHANGELOG.md** - Version history (create if missing)
- ✅ **assets/angular.ico** - Extension icon (128x128px minimum, PNG format recommended)

### 4.3 Create .vscodeignore

Create a `.vscodeignore` file to exclude unnecessary files from the package:

```
.vscode/**
.github/**
.agent/**
.gitignore
tsconfig.json
*.ts
!out/**/*.js
src/**
node_modules/**
!node_modules/axios/**
!node_modules/@babel/**
test/**
sample/**
*.vsix
.env
*.log
*.map
fix_filters.js
update_loader*.js
run_*.bat
test-*.ts
```

### 4.4 Add vscode:prepublish Script

Add to your `package.json` scripts:

```json
{
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p .",
    "watch": "tsc -watch -p ."
  }
}
```

This ensures TypeScript is compiled before publishing.

---

## Step 5: Test Packaging Locally

Before publishing, test that your extension packages correctly:

```bash
vsce package
```

This creates a `.vsix` file (e.g., `angular-tanslation-extractor-0.0.1.vsix`).

### Test Installation

Install the packaged extension locally to test:

```bash
code --install-extension angular-tanslation-extractor-0.0.1.vsix
```

Or from VS Code:
1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X)
3. Click `...` (Views and More Actions)
4. Select **Install from VSIX...**
5. Select your `.vsix` file

Test all extension features thoroughly before publishing!

---

## Step 6: Publish to Marketplace

### 6.1 First-Time Publishing

```bash
vsce publish
```

This will:
1. Run `vscode:prepublish` script (compile TypeScript)
2. Package the extension
3. Upload to Marketplace
4. Make it available for installation

### 6.2 Publishing with Version Bump

To automatically increment the version:

```bash
# Patch version (0.0.1 -> 0.0.2)
vsce publish patch

# Minor version (0.0.1 -> 0.1.0)
vsce publish minor

# Major version (0.0.1 -> 1.0.0)
vsce publish major

# Specific version
vsce publish 1.2.3
```

This will:
- Update `package.json` version
- Create a git commit and tag (if in a git repo)
- Publish to Marketplace

### 6.3 Publishing Pre-release Versions

For beta/preview releases:

```bash
vsce publish --pre-release
```

Recommended versioning:
- **Release versions**: `0.2.x`, `0.4.x`, `0.6.x` (even minor numbers)
- **Pre-release versions**: `0.3.x`, `0.5.x`, `0.7.x` (odd minor numbers)

---

## Step 7: Monitor Your Extension

### 7.1 View Statistics

1. Go to [Publisher Management Page](https://marketplace.visualstudio.com/manage)
2. Click on your extension
3. View:
   - Install/download counts
   - Ratings & Reviews
   - Acquisition trends

### 7.2 Update Extension

After making changes:

```bash
npm run compile
vsce publish patch  # or minor/major
```

---

## Common Issues & Solutions

### Error: "403 Forbidden" or "401 Unauthorized"

**Causes**:
- Wrong PAT scope (needs "Marketplace (Manage)")
- PAT created for specific org instead of "All accessible organizations"
- PAT expired

**Solution**:
1. Create a new PAT with correct settings
2. Re-authenticate: `vsce login AdilsondeAlmeidaPedro`

### Error: "Extension name already exists"

The extension name or display name is already taken.

**Solution**:
- Change `name` field in `package.json`
- Change `displayName` field in `package.json`

### Error: "You exceeded the number of allowed tags"

More than 30 keywords in `package.json`.

**Solution**:
- Limit `keywords` array to maximum 30 items

### Extension Icon Not Showing

**Causes**:
- Icon file doesn't exist at specified path
- Icon is SVG (not allowed)
- Icon is too small

**Solution**:
- Use PNG format
- Minimum 128x128px (recommended 256x256px or 512x512px)
- Verify `icon` path in `package.json`

### Images in README Not Showing

**Causes**:
- Using relative paths without repository URL
- Using HTTP instead of HTTPS

**Solution**:
- Add `repository` field to `package.json` pointing to GitHub repo
- Use HTTPS URLs for images
- Or use `--baseContentUrl` and `--baseImagesUrl` flags when publishing

---

## Best Practices

### 1. Version Numbers

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes (1.0.0 -> 2.0.0)
- **MINOR**: New features, backward compatible (1.0.0 -> 1.1.0)
- **PATCH**: Bug fixes (1.0.0 -> 1.0.1)

### 2. Documentation

- Clear README with screenshots/GIFs
- Detailed configuration options
- Usage examples
- Troubleshooting section

### 3. Testing

- Test on Windows, macOS, and Linux (if possible)
- Test with different Angular versions
- Test all configuration options

### 4. CHANGELOG.md

Maintain a changelog following [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

## [0.0.2] - 2026-02-15
### Added
- New merge mode for translations
### Fixed
- Fixed blank property translation in merge mode

## [0.0.1] - 2026-02-10
### Added
- Initial release
- Extract strings from Angular components
- Generate translation JSON files
```

### 5. License

Ensure you have a LICENSE file. Common choices:
- MIT (permissive)
- Apache 2.0 (permissive with patent grant)
- GPL (copyleft)

### 6. Keywords

Choose relevant keywords for discoverability:
```json
"keywords": [
  "angular",
  "i18n",
  "translation",
  "internationalization",
  "localization",
  "ngx-translate",
  "extract",
  "typescript"
]
```

---

## Unpublishing / Removing

### Unpublish (keeps statistics, makes unavailable)

Via command line:
```bash
vsce unpublish AdilsondeAlmeidaPedro.angular-tanslation-extractor
```

Or via [Publisher Management Page](https://marketplace.visualstudio.com/manage):
1. Click extension
2. More Actions > Unpublish

### Remove (permanent, deletes statistics)

⚠️ **Warning**: This is irreversible!

Via command line:
```bash
vsce unpublish AdilsondeAlmeidaPedro.angular-tanslation-extractor
# Confirm by typing extension name
```

Or via Publisher Management Page:
1. Click extension
2. More Actions > Remove

---

## Continuous Integration (CI/CD)

### GitHub Actions Example

Create `.github/workflows/publish.yml`:

```yaml
name: Publish Extension

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Compile
        run: npm run compile
        
      - name: Publish to Marketplace
        run: |
          npm install -g @vscode/vsce
          vsce publish -p ${{ secrets.VSCE_PAT }}
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

**Setup**:
1. Go to GitHub repository > Settings > Secrets and variables > Actions
2. Add secret named `VSCE_PAT` with your Personal Access Token
3. Create a GitHub release to trigger publishing

---

## Additional Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Extension Marketplace](https://marketplace.visualstudio.com/vscode)
- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Extension Manifest Reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)

---

## Quick Reference Commands

```bash
# Install vsce
npm install -g @vscode/vsce

# Login to publisher
vsce login AdilsondeAlmeidaPedro

# Package extension (creates .vsix)
vsce package

# Package pre-release
vsce package --pre-release

# Publish (first time or update)
vsce publish

# Publish with version bump
vsce publish patch    # 0.0.1 -> 0.0.2
vsce publish minor    # 0.0.1 -> 0.1.0
vsce publish major    # 0.0.1 -> 1.0.0

# Publish pre-release
vsce publish --pre-release

# Unpublish extension (keeps stats)
vsce unpublish AdilsondeAlmeidaPedro.angular-tanslation-extractor

# Show extension info
vsce show AdilsondeAlmeidaPedro.angular-tanslation-extractor

# Verify package contents
vsce ls
```

---

## Support

If you encounter issues:

1. **VS Code Extension Issues**: [GitHub Issues](https://github.com/microsoft/vscode/issues)
2. **Marketplace Support**: [Manage Publishers & Extensions](https://marketplace.visualstudio.com/manage) > Contact Microsoft
3. **Community Help**: [Stack Overflow](https://stackoverflow.com/questions/tagged/vscode-extensions)

---

**Good luck with your extension! 🚀**
