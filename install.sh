#!/usr/bin/env bash

set -euo pipefail

GWT_DIR="$HOME/tools/gwt"
ZSHRC="$HOME/.zshrc"

echo "Installing gwt to $GWT_DIR..."

if [ -d "$GWT_DIR/.git" ]; then
  echo "Updating existing install..."
  git -C "$GWT_DIR" pull --ff-only
else
  git clone https://github.com/wweidner/gwt.git "$GWT_DIR"
fi

chmod +x "$GWT_DIR/dist/gwt.cjs"

# Add shell function to ~/.zshrc if not already present
if ! grep -q 'tools/gwt' "$ZSHRC" 2>/dev/null; then
  cat >> "$ZSHRC" <<'EOF'

# gwt — interactive git worktree manager
unalias gwt 2>/dev/null
gwt() {
  local _gwt_cd_file
  _gwt_cd_file="$(mktemp)"
  export GWT_CD_FILE="$_gwt_cd_file"
  "$HOME/tools/gwt/dist/gwt.cjs" "$@"
  local _gwt_dir
  _gwt_dir="$(cat "$_gwt_cd_file" 2>/dev/null)"
  rm -f "$_gwt_cd_file"
  unset GWT_CD_FILE
  [[ -n "$_gwt_dir" && -d "$_gwt_dir" ]] && cd "$_gwt_dir"
}
EOF
  echo "Added gwt shell function to $ZSHRC"
else
  echo "Shell function already present in $ZSHRC — skipping"
fi

echo ""
echo "Done! Run: source ~/.zshrc"
echo "Then type: gwt"
