# TAK Lite Server Release Process

This document outlines the process for creating releases of the TAK Lite Server.

## Version Numbering

We follow [Semantic Versioning](https://semver.org/) (SemVer) for version numbers:

- **MAJOR** version when you make incompatible API changes
- **MINOR** version when you add functionality in a backwards compatible manner  
- **PATCH** version when you make backwards compatible bug fixes

Examples: `v1.0.0`, `v1.1.0`, `v1.1.1`, `v2.0.0`

## Release Process

### 1. Update Version in package.json

Before creating a release, update the version in `package.json`:

```bash
# For patch releases (bug fixes)
npm version patch

# For minor releases (new features)
npm version minor

# For major releases (breaking changes)
npm version major
```

This will automatically update the version in `package.json` and create a git tag.

### 2. Create a GitHub Release

#### Option A: Using Git Tags (Recommended)

1. Push your changes and the new tag:
   ```bash
   git push origin main
   git push origin v1.0.0  # Replace with your version
   ```

2. The GitHub Actions workflow will automatically:
   - Run tests
   - Build the project
   - Create a GitHub release
   - Upload build artifacts

#### Option B: Manual Release

1. Go to the GitHub repository
2. Click "Releases" → "Create a new release"
3. Choose a tag version (e.g., `v1.0.0`)
4. Add release title and description
5. Upload any additional files if needed
6. Click "Publish release"

#### Option C: Using GitHub Actions Workflow Dispatch

1. Go to the GitHub repository
2. Click "Actions" → "Release" workflow
3. Click "Run workflow"
4. Enter the version number (e.g., `v1.0.0`)
5. Click "Run workflow"

### 3. Release Notes Template

When creating a release, include the following information:

```markdown
## TAK Lite Server v1.0.0

### New Features
- Feature 1 description
- Feature 2 description

### Bug Fixes
- Fix 1 description
- Fix 2 description

### Improvements
- Improvement 1 description
- Improvement 2 description

### Migration Notes
- Any breaking changes or migration steps
- Configuration changes required
- Database migration requirements

### 🔗 Links
- [Full Changelog](https://github.com/your-org/tak-lite-server/compare/v0.9.0...v1.0.0)
- [Documentation](https://github.com/your-org/tak-lite-server#readme)
```

## Version Display

The version number is automatically displayed in the admin dashboard under the "Overview" section. The version information is fetched from the `/api/admin/version` endpoint, which returns:

```json
{
  "version": "1.0.0",
  "name": "tak-lite-server",
  "description": "Cloud-native backend server for TAK Lite situational awareness platform",
  "buildTime": "2024-01-15T10:30:00.000Z"
}
```

## Pre-release Versions

For pre-release versions (alpha, beta, rc), use the following format:

- `v1.0.0-alpha.1`
- `v1.0.0-beta.1`
- `v1.0.0-rc.1`

These can be created using:

```bash
npm version prerelease --preid=alpha
npm version prerelease --preid=beta
npm version prerelease --preid=rc
```

## Hotfix Process

For urgent bug fixes that need to be released immediately:

1. Create a hotfix branch from the latest release tag:
   ```bash
   git checkout -b hotfix/v1.0.1 v1.0.0
   ```

2. Make your fixes and commit:
   ```bash
   git add .
   git commit -m "fix: critical bug description"
   ```

3. Update version and create release:
   ```bash
   npm version patch
   git push origin hotfix/v1.0.1
   git push origin v1.0.1
   ```

4. Merge back to main:
   ```bash
   git checkout main
   git merge hotfix/v1.0.1
   git push origin main
   ```

## Automated Release Workflow

The GitHub Actions workflow (`.github/workflows/release.yml`) automatically:

1. **Triggers** on:
   - Git tag pushes (e.g., `git push origin v1.0.0`)
   - Manual workflow dispatch

2. **Runs**:
   - Tests (`npm test`)
   - Build (`npm run build`)
   - Creates GitHub release
   - Uploads build artifacts
   - Builds Docker image (if configured)

## Best Practices

1. **Always test locally** before creating a release
2. **Update CHANGELOG.md** with release notes
3. **Tag releases** with descriptive commit messages
4. **Use conventional commits** for better automation
5. **Keep release notes** clear and user-friendly
6. **Test the admin dashboard** to ensure version displays correctly

## Troubleshooting

### Version not displaying in admin dashboard
- Check that the `/api/admin/version` endpoint is accessible
- Verify the version is correctly set in `package.json`
- Check browser console for JavaScript errors

### Release workflow fails
- Ensure all tests pass locally
- Check that the version tag follows SemVer format
- Verify GitHub Actions secrets are configured

### Docker build fails
- Check Dockerfile syntax
- Ensure all dependencies are properly listed
- Verify build context includes all necessary files

