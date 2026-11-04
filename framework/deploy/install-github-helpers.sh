#!/bin/sh
# Installs the GitHub App helpers on the VPS (github-app@1): the git credential helper and the gh wrapper.
#   sh framework/deploy/install-github-helpers.sh            (root; idempotent; backs up what it replaces once)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
for pair in "axf-git-cred:/usr/local/bin/axf-git-cred" "gh-app:/usr/local/bin/gh"; do
  src="$HERE/${pair%%:*}"; dst="${pair#*:}"
  if [ -f "$dst" ] && ! cmp -s "$src" "$dst" && [ ! -f "$dst.pre-github-app" ]; then cp -p "$dst" "$dst.pre-github-app"; fi
  install -m 0755 "$src" "$dst"
done
[ -x /usr/bin/gh ] || echo "note: /usr/bin/gh is missing; the gh wrapper needs the real gh there (or AXF_REAL_GH)"
git config --global --get-all credential.https://github.com.helper | grep -q axf-git-cred || {
  git config --global --add credential.https://github.com.helper ''
  git config --global --add credential.https://github.com.helper /usr/local/bin/axf-git-cred
}
echo "GitHub helpers installed: git → axf-git-cred (app token, old token fallback); gh → app user/installation token"
