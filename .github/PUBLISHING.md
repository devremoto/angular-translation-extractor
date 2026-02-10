# Publishing the VS Code Extension

This repository includes GitHub Actions workflows for automated publishing of the VS Code extension to the Visual Studio Code Marketplace.

## Workflows

### 1. CI Workflow (`ci.yml`)

Runs on every push and pull request to main branches to ensure the extension builds correctly.

- **Triggers**: Push/PR to main, master, or develop branches
- **Tests**: Multiple Node.js versions (16, 18, 20)
- **Steps**: Install dependencies, lint, test, build, and package the extension

### 2. Publish Workflow (`publish-vscode-extension.yml`)

Publishes the extension to the VS Code Marketplace.

- **Triggers**: 
  - Automatically on new version tags (e.g., `v1.0.0`)
  - Manually via GitHub UI

## Setup Instructions

### Prerequisites

1. **Publisher Account**: You must have a publisher account on the VS Code Marketplace
   - The extension's `package.json` lists the publisher as: `AdilsondeAlmeidaPedro`
   - Ensure this publisher account exists at: https://marketplace.visualstudio.com/manage

2. **Azure DevOps PAT**: Create a Personal Access Token for publishing

### Creating the Personal Access Token (PAT)

1. Go to https://dev.azure.com/
2. Sign in with your Microsoft account (same account as your VS Code publisher)
3. Click on **User Settings** (top right) > **Personal Access Tokens**
4. Click **"New Token"**
5. Configure the token:
   - **Name**: `VS Code Marketplace Publishing`
   - **Organization**: `All accessible organizations`
   - **Expiration**: Choose an appropriate duration (e.g., 1 year)
   - **Scopes**: Click **"Show all scopes"** and select:
     - **Marketplace** > **Manage** (check the box)
6. Click **"Create"** and copy the generated token immediately (you won't be able to see it again)

### Adding the Token to GitHub

1. Go to your GitHub repository
2. Navigate to **Settings** > **Secrets and variables** > **Actions**
3. Click **"New repository secret"**
4. Add the secret:
   - **Name**: `VSCE_PAT`
   - **Value**: Paste your Personal Access Token
5. Click **"Add secret"**

## Publishing Process

### Automatic Publishing (Recommended)

1. Update the version in `package.json`:
   ```json
   {
     "version": "1.0.0"
   }
   ```

2. Commit your changes:
   ```bash
   git add package.json
   git commit -m "Bump version to 1.0.0"
   ```

3. Create and push a version tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

4. The workflow will automatically:
   - Build and test the extension
   - Package it as a `.vsix` file
   - Publish to VS Code Marketplace
   - Create a GitHub Release with the `.vsix` file attached

### Manual Publishing

1. Go to your repository on GitHub
2. Click on **Actions** tab
3. Select **"Publish VS Code Extension"** workflow
4. Click **"Run workflow"** button
5. Choose whether to publish to marketplace (true/false)
6. Click **"Run workflow"**

## Version Management

Follow semantic versioning (semver) for your extension versions:

- **Major version** (x.0.0): Breaking changes
- **Minor version** (0.x.0): New features, backwards compatible
- **Patch version** (0.0.x): Bug fixes, backwards compatible

Examples:
- `v0.0.1` - Initial release
- `v0.1.0` - Added new features
- `v1.0.0` - First stable release
- `v1.0.1` - Bug fix release

## Troubleshooting

### Build Failures

- Check that all dependencies are properly listed in `package.json`
- Ensure tests pass locally: `npm test`
- Verify the extension packages locally: `npx vsce package`

### Publishing Failures

- **Error: Invalid PAT**: Regenerate your Personal Access Token
- **Error: Publisher not found**: Verify the publisher name in `package.json` matches your VS Code Marketplace publisher
- **Error: Version already exists**: Update the version number in `package.json`

### PAT Expiration

When your PAT expires:
1. Create a new PAT following the steps above
2. Update the `VSCE_PAT` secret in GitHub repository settings

## Local Testing

Before publishing, test the extension packaging locally:

```bash
# Install vsce globally
npm install -g @vscode/vsce

# Package the extension
vsce package

# This creates a .vsix file that you can install locally for testing
```

To install the packaged extension locally:
1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X)
3. Click the "..." menu > "Install from VSIX..."
4. Select your `.vsix` file

## Resources

- [VS Code Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [vsce Documentation](https://github.com/microsoft/vscode-vsce)
- [Azure DevOps PAT](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)
