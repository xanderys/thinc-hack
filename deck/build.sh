#!/bin/sh
# Renders the deck. Refuses while any claim is unconfirmed.
set -e
cd "$(dirname "$0")"
if grep -n "\[UNCONFIRMED" slides.md; then
  echo "Refusing to render: confirm the items above first." >&2
  exit 1
fi
marp slides.md --theme theme.css --allow-local-files --pdf -o marquee-reonic.pdf
marp slides.md --theme theme.css --allow-local-files --pptx -o marquee-reonic.pptx
echo "Built deck/marquee-reonic.pdf and deck/marquee-reonic.pptx"
