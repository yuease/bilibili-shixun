import crypto from 'node:crypto';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

function keyFromUrl(url) {
  const name = String(url ?? '').split('/').pop() ?? '';
  return name.split('.')[0] ?? '';
}

export function mixinKey(imgKey, subKey) {
  const raw = `${imgKey}${subKey}`;
  if (raw.length < 64) return '';
  return MIXIN_KEY_ENC_TAB.map((index) => raw[index]).join('').slice(0, 32);
}

/** Build a WBI-signed query string (Cordis/Bilibili web signer). */
export function signQuery(params, keys) {
  if (!keys?.imgKey || !keys?.subKey) throw new Error('wbi keys missing');
  const mixin = mixinKey(keys.imgKey, keys.subKey);
  const all = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(all)
    .sort()
    .map((key) => {
      // The canonical signer drops these characters before percent-encoding.
      const raw = String(all[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(raw)}`;
    })
    .join('&');
  const wRid = crypto.createHash('md5').update(query + mixin).digest('hex');
  return `${query}&w_rid=${wRid}`;
}

export function wbiKeysFromNav(nav) {
  const img = keyFromUrl(nav?.data?.wbi_img?.img_url);
  const sub = keyFromUrl(nav?.data?.wbi_img?.sub_url);
  if (!img || !sub) return null;
  return { imgKey: img, subKey: sub, fetchedAt: Date.now() };
}

/** The DM parameters Bilibili's web client sends with space endpoints. */
export const DM_PARAMS = {
  dm_img_list: '[]',
  dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ',
  dm_cover_img_str:
    'QU5HTEUgKEludGVsLCBJbnRlbChSKSBVSEQgR3JhcGhpY3MgNjMwICgweDAwMDAzRTlCKSBEaXJlY3QzRDExIHZzXzVfMCBwc181XzApLCBvciBzaW1pbGFy',
  dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
};
