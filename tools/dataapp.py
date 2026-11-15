#!/usr/bin/env python3
"""
Tableau Data App のワークスペース操作ツール(このリポジトリ独自の実装)。

  python3 tools/dataapp.py new "<App Name>" [--author NAME] [--id-prefix com.example]
  python3 tools/dataapp.py wire "apps/<App Name>" descriptor.json
  python3 tools/dataapp.py package "apps/<App Name>"

new     : template/ (scaffold-data-app が返す未置換テンプレート) を apps/<App Name>/ に
          コピーし、TODO トークンを置換してファイル名を確定する。
wire    : .twb の 2 か所の空 <datasources /> にデータソースを配線する。
          パブリッシュ済みデータソース(sqlproxy)と、Data/ 配下の CSV(textscan)に対応。
package : ワークスペースを dist/<App Name>.twbx に固める。.twb と Packages/ を
          アーカイブ直下に置く(<App Name>/ で一段ネストすると開けない)。

XML の形は公式ドキュメント(Data App Details)と公式サンプル、tableau-plugin の
data app authoring スキルが出力する形に合わせている。標準ライブラリのみで動く。
"""

import argparse
import json
import os
import re
import secrets
import shutil
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, 'template', 'Data App Name')
EMPTY_ANCHOR = '<datasources />'
# scaffold-data-app が 2026-11-15 に返した値。サイトのバージョンに合わせて上書きできる。
DEFAULT_SOURCE_BUILD = '2026.3.4 (20263.26.1110.1356)'


def die(message):
    print(f'✗ {message}', file=sys.stderr)
    sys.exit(1)


def esc(value):
    return (str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace("'", '&apos;').replace('"', '&quot;'))


# ---------------------------------------------------------------- new

def slugify(name):
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    if not slug:
        die('アプリ名から package id を作れません(英数字を含めてください)。')
    return slug


def cmd_new(args):
    name = args.name
    if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,98}[A-Za-z0-9])?', name):
        die('アプリ名は英数字・空白・ . _ - のみ(scaffold-data-app と同じ制約)。')
    package_id = f'{args.id_prefix}.{slugify(name)}'
    dest = os.path.join(ROOT, 'apps', name)
    if os.path.exists(dest):
        die(f'既に存在します: {dest}')
    shutil.copytree(TEMPLATE, dest)

    tokens = [
        ('TODO-SOURCE-BUILD', args.source_build),
        ('TODO-MANIFEST-ID', package_id),
        ('TODO App Name', name),
        ('TODO Sheet Name', args.sheet or name),
        ('TODO-MANIFEST-VERSION', args.version),
        ('TODO Author Name', args.author),
    ]
    package_dir = os.path.join(dest, 'Packages', 'TODO-MANIFEST-ID')
    for path in (os.path.join(dest, 'Data App Name.twb'),
                 os.path.join(package_dir, 'extensions', 'data-app.trex'),
                 os.path.join(package_dir, 'manifest.json')):
        with open(path, encoding='utf-8') as f:
            content = f.read()
        for find, replace in tokens:
            content = content.replace(find, replace)
        if 'TODO' in content:
            die(f'置換漏れの TODO が残っています: {path}')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
    os.rename(package_dir, os.path.join(dest, 'Packages', package_id))
    os.rename(os.path.join(dest, 'Data App Name.twb'), os.path.join(dest, f'{name}.twb'))
    print(f'✓ {dest}  (package id: {package_id})')


# ---------------------------------------------------------------- wire

def field_info(field, ordinal):
    name = field['name']
    datatype = str(field.get('datatype', 'string')).lower()
    measure = field.get('role') == 'measure'
    if datatype in ('real', 'integer'):
        kind = 'quantitative'
    elif datatype in ('date', 'datetime'):
        kind = 'ordinal'
    else:
        kind = 'nominal'
    return {
        'name': name, 'datatype': datatype, 'kind': kind, 'ordinal': ordinal,
        'role': 'measure' if measure else 'dimension',
        'aggregation': 'Sum' if measure else 'Count',
        'role_attr': 1 if measure else 0,
        'local': f'[{name}]',
        'derivation': 'Sum' if measure else 'None',
        'instance': f'[sum:{name}:qk]' if measure else f'[none:{name}:nk]',
    }


def metadata_records(fields, parent, published):
    out = []
    for f in fields:
        extra = ''
        if published:
            extra = f"""
            <attributes>
              <attribute datatype='integer' name='field-type'>1</attribute>
              <attribute datatype='integer' name='role'>{f['role_attr']}</attribute>
            </attributes>"""
        layered = "\n            <layered>true</layered>" if published else ''
        out.append(f"""          <metadata-record class='column'>
            <remote-name>{esc(f['name'])}</remote-name>
            <remote-type>{5 if f['kind'] == 'quantitative' else 129}</remote-type>
            <local-name>{esc(f['local'])}</local-name>
            <parent-name>{esc(parent)}</parent-name>
            <remote-alias>{esc(f['name'])}</remote-alias>
            <ordinal>{f['ordinal']}</ordinal>{layered}
            <local-type>{esc(f['datatype'])}</local-type>
            <aggregation>{f['aggregation']}</aggregation>
            <contains-null>true</contains-null>{extra}
          </metadata-record>""")
    return '\n'.join(out)


def published_xml(ds):
    return f"""    <datasource caption='{esc(ds['caption'])}' inline='true' name='{ds['key']}' version='18.1'>
      <repository-location id='{esc(ds['repositoryId'])}' path='/datasources' revision='1.0' />
      <connection channel='https' class='sqlproxy' dbname='{esc(ds['repositoryId'])}' directory='dataserver' server-ds-friendly-name='{esc(ds['caption'])}' username=''>
        <relation type='collection'>
          <relation connection='{ds['key']}' name='sqlproxy' table='[sqlproxy]' type='table' />
        </relation>
        <metadata-records>
{metadata_records(ds['fields'], '[sqlproxy]', True)}
        </metadata-records>
      </connection>
    </datasource>"""


def csv_xml(ds):
    directory, filename = ds['file'].rsplit('/', 1)
    stem, extension = filename.rsplit('.', 1)
    connection = 'textscan.' + ds['key'].split('.', 1)[1]
    return f"""    <datasource caption='{esc(ds['caption'])}' inline='true' name='{ds['key']}' version='18.1'>
      <connection class='federated'>
        <named-connections>
          <named-connection caption='{esc(ds['caption'])}' name='{connection}'>
            <connection class='textscan' directory='{esc(directory)}' filename='{esc(filename)}' password='' server='' />
          </named-connection>
        </named-connections>
        <relation connection='{connection}' name='{esc(filename)}' table='[{esc(stem)}#{esc(extension)}]' type='table' />
        <metadata-records>
{metadata_records(ds['fields'], f'[{filename}]', False)}
        </metadata-records>
      </connection>
    </datasource>"""


def cmd_wire(args):
    workspace = os.path.abspath(args.workspace)
    twb_path = find_twb(workspace)
    with open(args.descriptor, encoding='utf-8') as f:
        descriptor = json.load(f)
    entries = descriptor['datasources'] if 'datasources' in descriptor else [descriptor]

    datasources, captions = [], set()
    for entry in entries:
        if entry['caption'] in captions:
            die(f'caption が重複しています: {entry["caption"]}')
        captions.add(entry['caption'])
        is_file = entry.get('type') == 'file'
        ds = {
            'caption': entry['caption'],
            'published': not is_file,
            'key': ('federated.' if is_file else 'sqlproxy.') + secrets.token_hex(11),
            'fields': [field_info(f, i) for i, f in enumerate(entry['fields'])],
        }
        if is_file:
            ds['file'] = entry['file'].replace('\\', '/')
            if not ds['file'].startswith('Data/') or not ds['file'].lower().endswith('.csv'):
                die('file は Data/ 配下の .csv を指定してください。')
            if not os.path.isfile(os.path.join(workspace, ds['file'])):
                die(f'ワークスペースにファイルがありません: {ds["file"]}')
        else:
            ds['repositoryId'] = entry['repositoryId']  # パブリッシュ済み DS の contentUrl
        datasources.append(ds)

    with open(twb_path, encoding='utf-8') as f:
        content = f.read()
    split = content.find('<worksheets>')
    head, tail = content[:split], content[split:]
    if "class='sqlproxy'" in head or "class='federated'" in head:
        die('この .twb は配線済みです。作り直す場合は new からやり直してください。')
    if EMPTY_ANCHOR not in head or EMPTY_ANCHOR not in tail:
        die('空の <datasources /> アンカーが見つかりません(テンプレートが変わった可能性)。')

    root_block = '<datasources>\n' + '\n'.join(
        published_xml(ds) if ds['published'] else csv_xml(ds) for ds in datasources) + '\n  </datasources>'

    primary = datasources[0]
    view_list = '\n'.join(
        f"            <datasource caption='{esc(ds['caption'])}' name='{ds['key']}' />" for ds in datasources)
    columns = '\n'.join(
        f"            <column aggregation='{f['aggregation']}' datatype='{esc(f['datatype'])}' "
        f"name='{esc(f['local'])}' role='{f['role']}' type='{f['kind']}' />" for f in primary['fields'])
    instances = '\n'.join(
        f"            <column-instance column='{esc(f['local'])}' derivation='{f['derivation']}' "
        f"name='{esc(f['instance'])}' pivot='key' type='{f['kind']}' />" for f in primary['fields'])
    view_block = f"""<datasources>
{view_list}
          </datasources>
          <datasource-dependencies datasource='{primary['key']}'>
{columns}
{instances}
          </datasource-dependencies>"""

    wired = head.replace(EMPTY_ANCHOR, root_block, 1) + tail.replace(EMPTY_ANCHOR, view_block, 1)
    ET.fromstring(wired.encode('utf-8'))  # 壊れた XML は書き出さない
    with open(twb_path, 'w', encoding='utf-8') as f:
        f.write(wired)
    for ds in datasources:
        print(f"✓ wired '{ds['caption']}' ({ds['key']}, {len(ds['fields'])} fields)")


# ---------------------------------------------------------------- package

def find_twb(workspace):
    twbs = [n for n in os.listdir(workspace) if n.endswith('.twb')]
    if len(twbs) != 1:
        die(f'.twb がちょうど 1 つ必要です: {workspace}')
    return os.path.join(workspace, twbs[0])


def referenced_data_files(twb_path):
    referenced = set()
    for element in ET.parse(twb_path).getroot().iter('connection'):
        directory = element.get('directory', '').rstrip('/')
        filename = element.get('filename', '')
        path = f'{directory}/{filename}' if directory and filename else filename
        if path.startswith('Data/'):
            referenced.add(path)
    return referenced


def cmd_package(args):
    workspace = os.path.abspath(args.workspace)
    twb_path = find_twb(workspace)
    twb = os.path.basename(twb_path)
    with open(twb_path, encoding='utf-8') as f:
        twb_text = f.read()
    if EMPTY_ANCHOR in twb_text:
        print('⚠ データソース未配線です(アプリは "no data source found" になります)。', file=sys.stderr)

    packages = os.path.join(workspace, 'Packages')
    trex = [p for p in os.listdir(packages)
            if os.path.isdir(os.path.join(packages, p, 'extensions'))
            and any(n.endswith('.trex') for n in os.listdir(os.path.join(packages, p, 'extensions')))]
    if not trex:
        die('Packages/*/extensions/ に .trex がありません。')
    for package in trex:
        manifest_path = os.path.join(packages, package, 'manifest.json')
        with open(manifest_path, encoding='utf-8') as f:
            origins = json.load(f).get('requestedOrigins', '')
        if not isinstance(origins, str):
            die(f'{manifest_path}: requestedOrigins は空白区切りの 1 つの文字列にしてください。')

    data_files = referenced_data_files(twb_path)
    for rel in data_files:
        if not os.path.isfile(os.path.join(workspace, rel)):
            die(f'.twb が参照するデータファイルがありません: {rel}')

    out_dir = os.path.join(ROOT, 'dist')
    os.makedirs(out_dir, exist_ok=True)
    output = os.path.join(out_dir, os.path.basename(workspace) + '.twbx')

    entries = []
    for top in ('Packages', 'Data', 'Resources/.agents'):
        base = os.path.join(workspace, top)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith('.'))
            for filename in sorted(filenames):
                rel = os.path.relpath(os.path.join(dirpath, filename), workspace).replace(os.sep, '/')
                if filename.startswith('.') or (top == 'Data' and rel not in data_files):
                    continue
                entries.append(rel)

    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.write(twb_path, twb)  # .twb を先頭・アーカイブ直下に
        for rel in entries:
            archive.write(os.path.join(workspace, rel), rel)
    size = os.path.getsize(output)
    print(f'✓ {output}  ({len(entries) + 1} files, {size / 1024:.0f} KB)')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    p_new = sub.add_parser('new')
    p_new.add_argument('name')
    p_new.add_argument('--author', default='Tableau MCP')
    p_new.add_argument('--id-prefix', default='com.tableau.mcp')
    p_new.add_argument('--version', default='1.0.0')
    p_new.add_argument('--sheet', default=None)
    p_new.add_argument('--source-build', default=DEFAULT_SOURCE_BUILD)
    p_new.set_defaults(func=cmd_new)

    p_wire = sub.add_parser('wire')
    p_wire.add_argument('workspace')
    p_wire.add_argument('descriptor')
    p_wire.set_defaults(func=cmd_wire)

    p_package = sub.add_parser('package')
    p_package.add_argument('workspace')
    p_package.set_defaults(func=cmd_package)

    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
