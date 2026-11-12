# lint-web.sh: lint for sebaro web sources, the CSS a product writes and its pages. Source files, not a built bundle.
# Usage: sh lint-web.sh <css file>... <page dir>   (the pages are searched with their subfolders for .html)
# Exit 0: clean, nothing printed · 1: a finding, one line each: <rule> <file>:<line>: <text> · 2: usage.
usage() { echo "lint-web.sh: $1" >&2; echo "usage: sh lint-web.sh <css file>... <page dir>" >&2; exit 2; }
hits() { [ -z "$3" ] || { printf '%s\n' "$3" | RULE="$1" FILE="$2" awk '{ n = $0; sub(/:.*/, "", n); sub(/^[0-9]+:/, ""); print ENVIRON["RULE"] " " ENVIRON["FILE"] ":" n ": " $0 }'; bad=1; }; }
[ "$#" -ge 2 ] || usage "needs at least one CSS file and the folder of the pages"
for PAGES in "$@"; do :; done
[ -d "$PAGES" ] || usage "$PAGES is not a folder (the last argument is the folder of the .html pages)"
[ -n "$(find "$PAGES" -type f -name '*.html' | head -n 1)" ] || usage "no .html file under $PAGES"
n=$#; for CSS in "$@"; do n=$((n - 1)); [ "$n" -eq 0 ] || [ -f "$CSS" ] || usage "$CSS is not a file"; done
bad=0; n=$#
for CSS in "$@"; do
  n=$((n - 1)); [ "$n" -gt 0 ] || break
  awk '/\{/ {sel=$0} /var\(--sb-color-(on-)?primary-action/ && sel !~ /\.sb-primary-action/ {print "L1 " FILENAME ":" FNR ": " $0; bad=1} END {exit bad}' "$CSS" || bad=1   # L1
  awk '/\{/ {sel=$0} /--sb-color-(accent|success|warning|danger|info)-subtle|--sb-color-text-on-/ && sel !~ /\.sb-diff__line--(add|del)/ {print "L2 " FILENAME ":" FNR ": " $0; bad=1} END {exit bad}' "$CSS" || bad=1   # L2
  hits L3 "$CSS" "$(grep -nE 'data-product' "$CSS")"   # L3
  awk '/\{/ {sel=$0} /background(-color)?:[^;]*var\(--sb-color-(accent|link|success|warning|danger|info)\)/ && sel !~ /\.sb-(switch|radio|range)/ {print "L4 " FILENAME ":" FNR ": " $0; bad=1} END {exit bad}' "$CSS" || bad=1   # L4
  hits L5 "$CSS" "$(grep -nE '#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(' "$CSS")"   # L5
  hits L6 "$CSS" "$(grep -nE 'https?://' "$CSS")"   # L6
  hits L7 "$CSS" "$(grep -nE 'sb-notes__list[^{]*\{[^}]*(columns|grid-template-columns: *repeat)' "$CSS")"   # L7
  awk '/\}/ {acc=""} /\{/ {sel=$0; sub(/\{.*/, "", sel); sel=acc sel; acc=""} !/[{};]/ && /,[[:space:]]*$/ {acc=acc $0} /(^|[^-])(height|block-size):[^;]*var\(--sb-size-control/ && !/(height|block-size): *max\([^;]*[0-9](lh|em)[,) ]/ {n=split(sel, s, ","); ex=(n>0); for (i=1; i<=n; i++) if (s[i] !~ /(svg|\.sb-icon-button|__twist)[^[:space:]>+~]*[[:space:]]*$/) ex=0; if (!ex) {print "L8 " FILENAME ":" FNR ": " $0; bad=1}} END {exit bad}' "$CSS" || bad=1   # L8
done
# the pages: L3 outside the inlined brand snippets, L8 in a style attribute
find "$PAGES" -type f -name '*.html' -exec perl -0ne 's{(<!-- sb:inline src="[^"]*brand/inline/[^"]*" -->.*?<!-- /sb:inline -->)}{$1 =~ tr/\n//cdr}gse; my $n = 0; for (split /\n/) { $n++; if (/data-product/) { print "L3 $ARGV:$n: $_\n"; $bad = 1 } if (/style="([^"]*[^-])?(height|block-size):[^";]*var\(--sb-size-control/) { print "L8 $ARGV:$n: $_\n"; $bad = 1 } } END { exit $bad }' {} + || bad=1
exit $bad
