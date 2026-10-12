# Lists every video (id, title) on the Atlantic Notes channel via YouTube's public page data.
#   python3 tools/fetch_youtube.py tools/youtube_videos.json
# then re-run tools/build_collection.py to refresh the "Watch" links.
import json, re, sys, time, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9', 'Cookie': 'CONSENT=YES+1; SOCS=CAI'}

def get(url, data=None):
    headers = dict(UA)
    if data is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(data).encode()
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=30) as r:
        return r.read().decode('utf-8')

def walk(o, out):
    if isinstance(o, dict):
        lv = o.get('lockupViewModel')
        if lv and lv.get('contentId'):
            title = lv.get('metadata', {}).get('lockupMetadataViewModel', {}).get('title', {}).get('content')
            out['videos'].append({'id': lv['contentId'], 'title': title})
            return
        cc = o.get('continuationCommand')
        if cc and cc.get('token'):
            out['token'] = cc['token']
        for v in o.values():
            walk(v, out)
    elif isinstance(o, list):
        for v in o:
            walk(v, out)

html = get('https://www.youtube.com/@AtlanticNotesPiano/videos')
data = json.loads(re.search(r'var ytInitialData = (\{.*?\});</script>', html).group(1))
key = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html).group(1)
ctx = json.loads(re.search(r'"INNERTUBE_CONTEXT":(\{.*?\}),"INNERTUBE_CONTEXT_CLIENT_NAME"', html).group(1))

videos = {}
out = {'videos': [], 'token': None}
tabs = data['contents']['twoColumnBrowseResultsRenderer']['tabs']
walk(next(t for t in tabs if t.get('tabRenderer', {}).get('selected')), out)
for v in out['videos']:
    videos[v['id']] = v['title']
pages = 0
while out['token'] and pages < 150:
    j = json.loads(get(f'https://www.youtube.com/youtubei/v1/browse?key={key}&prettyPrint=false', {'context': ctx, 'continuation': out['token']}))
    out = {'videos': [], 'token': None}
    walk(j, out)
    for v in out['videos']:
        videos[v['id']] = v['title']
    pages += 1
    time.sleep(0.2)

json.dump([{'id': k, 'title': t} for k, t in videos.items()], open(sys.argv[1], 'w'), ensure_ascii=False)
print(len(videos), 'videos,', pages, 'pages')
