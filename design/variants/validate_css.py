#!/usr/bin/env python3
"""Mechanical scoping check for a style sheet (mirrors the catalog's rule: every selector starts with .style-<slug>)."""
import re
import sys
from pathlib import Path


def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def iter_rules(css):
    """Yield (selector_text, body) for top-level and nested (@media/@supports) rules; skip @keyframes bodies."""
    i, n = 0, len(css)
    stack = []
    while i < n:
        j = css.find('{', i)
        if j < 0:
            break
        head = css[i:j].strip()
        # find matching brace
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == '{':
                depth += 1
            elif css[k] == '}':
                depth -= 1
            k += 1
        body = css[j + 1:k - 1]
        if head.startswith('@keyframes'):
            yield head, None
        elif head.startswith('@media') or head.startswith('@supports') or head.startswith('@container'):
            for h, b in iter_rules(body):
                yield h, b
        elif head.startswith('@'):
            yield head, body
        else:
            yield head, body
        i = k


def validate(slug, css):
    problems = []
    css = strip_comments(css)
    if '@import' in css:
        problems.append('contains @import')
    if re.search(r'url\s*\(', css):
        problems.append('contains url(')
    if 'backdrop-filter' in css:
        problems.append('contains backdrop-filter')
    if re.search(r'filter\s*:\s*[^;]*blur', css):
        problems.append('contains filter: blur')
    for head, body in iter_rules(css):
        if head.startswith('@keyframes'):
            name = head.split()[1] if len(head.split()) > 1 else ''
            if not name.startswith(f'{slug}-'):
                problems.append(f'@keyframes not prefixed: {head}')
            continue
        if head.startswith('@font-face'):
            problems.append('contains @font-face')
            continue
        if head.startswith('@'):
            continue
        for sel in head.split(','):
            s = sel.strip()
            if not s:
                continue
            if not s.startswith(f'.style-{slug}'):
                problems.append(f'unscoped selector: {s}')
            if re.search(r'(^|[\s>+~])(:root|html|body)(\b|[\s{:.,#\[])', s):
                problems.append(f'forbidden root/html/body in: {s}')
    # tokens for both themes
    if f'.style-{slug}[data-theme="dark"]' not in css and f".style-{slug}[data-theme='dark']" not in css:
        problems.append('no dark token block found')
    return problems


if __name__ == '__main__':
    slug = sys.argv[1]
    css = Path(sys.argv[2]).read_text(encoding='utf-8')
    p = validate(slug, css)
    print(f'{slug}: {len(p)} problems')
    for x in p[:60]:
        print(' -', x)
    sys.exit(1 if p else 0)
