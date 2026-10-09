"""Bundle the app into ONE self-contained HTML file (demo data only) for quick previews / single-file hosting."""
import base64, re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
order = ['engine', 'strategies', 'news', 'feed', 'scanner', 'views', 'chart', 'app']
parts = []
for name in order:
    src = (root / 'js' / f'{name}.js').read_text()
    src = re.sub(r"^import .*?from '.*?';\n", '', src, flags=re.M)
    src = re.sub(r'^export ', '', src, flags=re.M)
    parts.append(f'// ---- {name}.js\n{src}')
views = ['esc', 'SN', 'isLive', 'label', 'stateText', 'SIG_TABS', 'sigCard', 'stratChips', 'selectOptions', 'catChips', 'instrumentList',
         'signalList', 'signalTabs', 'newsList', 'pillText', 'instrumentPicker']
js = 'globalThis.ACS_FORCE_DEMO = true;\n' + '\n'.join(parts).replace('// ---- app.js', f"const V = {{ {', '.join(views)} }};\n// ---- app.js")
b64 = lambda p: 'data:%s;base64,%s' % ('image/png' if p.endswith('png') else 'image/jpeg', base64.b64encode((root / p).read_bytes()).decode())
logo, hero, fav = b64('assets/logo.jpg'), b64('assets/hero.jpg'), b64('assets/favicon.png')
css = (root / 'css' / 'app.css').read_text().replace('url(../assets/hero.jpg)', f'url({hero})')
html = (root / 'index.html').read_text()
html = re.sub(r'<link rel="manifest".*?>\n', '', html)
html = html.replace('href="assets/favicon.png"', f'href="{fav}"').replace('<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">\n', '')
html = html.replace('src="assets/logo.jpg"', f'src="{logo}"')
html = html.replace('<link rel="stylesheet" href="css/app.css">', f'<style>\n{css}\n</style>')
html = html.replace('<script type="module" src="js/app.js"></script>', f'<script type="module">\n{js}\n</script>')
out = root / 'dist'; out.mkdir(exist_ok=True)
(out / 'armageddon-preview.html').write_text(html)
(out / 'bundle.mjs').write_text(js)
print('preview bytes:', len(html.encode()))
