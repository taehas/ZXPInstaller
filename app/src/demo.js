// Fixture data for screenshots and demos (ZXP_DEMO=1). Never used in normal runs, so
// docs can show the UI without exposing anyone's real installed extensions.
const host = (name, min = 13, max = Infinity) => ({ name, min, max })
const ext = (o) => ({
  folder: o.folder ?? o.bundleId,
  dir: `/demo/${o.folder ?? o.bundleId}`,
  root: '/demo',
  scope: 'user',
  enabled: true,
  size: 4e6,
  mtime: 0,
  panelIds: [o.bundleId + '.panel'],
  runtimes: [{ name: 'CSXS', version: 9 }],
  signed: true,
  adobeManaged: false,
  error: null,
  ...o,
})

export function demoData () {
  const ae = host('AEFT')
  const ps = host('PHXS', 20)
  return {
    apps: [
      { name: 'After Effects 2026', family: 'After Effects', hosts: ['AEFT'], version: '26.5.0', major: 26.5 },
      { name: 'Photoshop 2026', family: 'Photoshop', hosts: ['PHXS', 'PHSP'], version: '27.10.0', major: 27.1 },
      { name: 'Illustrator 2026', family: 'Illustrator', hosts: ['ILST'], version: '30.8.2', major: 30.8 },
      { name: 'InDesign 2026', family: 'InDesign', hosts: ['IDSN'], version: '21.6.0', major: 21.6 },
    ],
    extensions: [
      ext({ bundleId: 'com.example.motionkit', name: 'Motion Kit', version: '3.2.1', hosts: [ae], size: 18.4e6 }),
      ext({ bundleId: 'com.example.motionkit', folder: 'motionkit-3.1.0', name: 'Motion Kit', version: '3.1.0', hosts: [ae], size: 17.9e6 }),
      ext({ bundleId: 'com.example.palette', name: 'Palette Pal', version: '1.4.0', hosts: [ps, host('ILST', 24)], size: 2.2e6 }),
      ext({ bundleId: 'com.example.typecraft', name: 'Typecraft', version: '2.0.0', hosts: [ae, ps], size: 6.1e6, scope: 'system' }),
      ext({ bundleId: 'com.example.cutlist', name: 'Cutlist', version: '1.0.3', hosts: [host('PPRO')], size: 7.8e6 }),
      ext({ bundleId: 'com.example.brokenpanel', name: 'brokenpanel', version: null, hosts: [], size: 0.4e6, error: 'Missing CSXS/manifest.xml', signed: false }),
      ext({ bundleId: 'com.example.futurepanel', name: 'Future Panel', version: '0.9.0', hosts: [ae], runtimes: [{ name: 'CSXS', version: 13 }], size: 3.3e6 }),
      ext({ bundleId: 'com.example.sketchy', name: 'Sketchy Tools', version: '0.5.2', hosts: [ae], signed: false, size: 1.1e6, enabled: false }),
      ext({ bundleId: 'com.adobe.ccx.start', name: 'CCX Start', version: '2.16.0.8', hosts: [ae, ps], size: 11.2e6, scope: 'system', adobeManaged: true }),
      ext({ bundleId: 'com.adobe.ccx.start', folder: 'com.adobe.ccx.start-2.7.2', name: 'CCX Start', version: '2.7.2.15', hosts: [ae, ps], size: 8.5e6, scope: 'system', adobeManaged: true }),
    ],
    debug: [9, 10, 11, 12].map(version => ({ version, on: true })),
    upia: [{ status: 'Enabled', name: 'Mockup Studio', version: '1.1.2', product: 'Photoshop 2026' }],
  }
}
