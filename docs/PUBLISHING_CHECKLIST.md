# Publishing Checklist

Use this checklist before publishing your extension to the VS Code Marketplace.

## Pre-Publishing Checklist

### ✅ Prerequisites
- [ ] Node.js installed
- [ ] `@vscode/vsce` installed globally (`npm install -g @vscode/vsce`)
- [ ] Azure DevOps account created
- [ ] Personal Access Token (PAT) generated with "Marketplace (Manage)" scope
- [ ] Publisher account created on Marketplace

### ✅ Package.json
- [ ] `name` is unique and follows naming conventions
- [ ] `displayName` is clear and descriptive
- [ ] `description` is comprehensive (under 120 characters)
- [ ] `version` follows semantic versioning (x.y.z)
- [ ] `publisher` matches your publisher ID: `AdilsondeAlmeidaPedro`
- [ ] `engines.vscode` version is correct: `^1.85.0`
- [ ] `icon` path is correct and file exists
- [ ] `categories` is appropriate
- [ ] `keywords` (max 30) for discoverability
- [ ] `repository` URL is set (if using GitHub)
- [ ] `bugs` URL is set
- [ ] `license` field is set
- [ ] `author` information is complete

### ✅ Required Files
- [ ] `README.md` exists with:
  - [ ] Clear description
  - [ ] Installation instructions
  - [ ] Configuration options
  - [ ] Usage examples
  - [ ] Screenshots/GIFs (if applicable)
- [ ] `LICENSE` file exists
- [ ] `CHANGELOG.md` exists with version history
- [ ] `CONTRIBUTING.md` (optional but recommended)
- [ ] Extension icon file exists (`assets/angular.ico` or similar)
- [ ] Icon is PNG format, minimum 128x128px

### ✅ Code Quality
- [ ] All TypeScript compiles without errors (`npm run compile`)
- [ ] No critical warnings
- [ ] Extension tested locally
- [ ] All features work as expected
- [ ] Tested with different workspaces

### ✅ .vscodeignore
- [ ] `.vscodeignore` file exists
- [ ] Excludes development files (.ts, tsconfig.json, src/)
- [ ] Excludes unnecessary files (tests, samples, .vscode/)
- [ ] Includes necessary runtime files (out/, node_modules/required-deps)

### ✅ Scripts
- [ ] `vscode:prepublish` script exists in package.json
- [ ] Runs `compile` before publish
- [ ] All dependencies are listed in `dependencies` (not just `devDependencies`)

### ✅ Testing
- [ ] Extension works in VS Code stable
- [ ] Extension works in VS Code Insiders (if targeting latest features)
- [ ] All commands are accessible
- [ ] Configuration options work
- [ ] No console errors in Extension Host

### ✅ Documentation
- [ ] README is clear and complete
- [ ] All configuration options are documented
- [ ] Examples are provided
- [ ] Known issues/limitations documented

## Publishing Commands

### Local Testing
```bash
# Compile
npm run compile

# Package locally
vsce package

# Test installation
code --install-extension angular-tanslation-extractor-0.0.1.vsix
```

### First Time Publish
```bash
# Login (only needed once)
vsce login AdilsondeAlmeidaPedro

# Publish
vsce publish
```

### Update Version and Publish
```bash
# Patch (0.0.1 -> 0.0.2)
vsce publish patch

# Minor (0.0.1 -> 0.1.0)
vsce publish minor

# Major (0.0.1 -> 1.0.0)
vsce publish major
```

### Pre-release
```bash
# Package pre-release
vsce package --pre-release

# Publish pre-release
vsce publish --pre-release
```

## Post-Publishing

### ✅ Verify Publication
- [ ] Extension appears on [VS Code Marketplace](https://marketplace.visualstudio.com/vscode)
- [ ] Extension page displays correctly
- [ ] Icon shows correctly
- [ ] README renders properly
- [ ] All links work

### ✅ Installation Test
- [ ] Install from Marketplace in VS Code
- [ ] Test all features again
- [ ] Check for any issues

### ✅ Monitoring
- [ ] Monitor [Publisher Management Page](https://marketplace.visualstudio.com/manage) for:
  - [ ] Install/download counts
  - [ ] User ratings
  - [ ] User reviews
  - [ ] Error reports

## Troubleshooting

### Common Issues

**403/401 Error**
- Verify PAT has "Marketplace (Manage)" scope
- Verify PAT is for "All accessible organizations"
- Login again: `vsce login AdilsondeAlmeidaPedro`

**Extension Name Exists**
- Change `name` or `displayName` in package.json

**Icon Not Showing**
- Verify icon path in package.json
- Ensure PNG format
- Minimum 128x128px

**Images in README Not Showing**
- Use HTTPS URLs
- Add repository URL to package.json
- Use absolute URLs or configure baseContentUrl

**Package Too Large**
- Check .vscodeignore excludes unnecessary files
- Remove development dependencies from dependencies
- Consider bundling with webpack

## Version Strategy

### Release Versions (Stable)
- Use even minor versions: `0.2.x`, `0.4.x`, `1.0.x`, `1.2.x`
- For production-ready features

### Pre-release Versions (Beta)
- Use odd minor versions: `0.3.x`, `0.5.x`, `1.1.x`, `1.3.x`
- For testing new features

## Notes

- Keep your PAT secure and never commit it to version control
- Update CHANGELOG.md before each release
- Test thoroughly before publishing
- Respond to user feedback and reviews
- Monitor extension statistics regularly

---

**Ready to publish? Review the full [PUBLISHING.md](PUBLISHING.md) guide for detailed steps!**
