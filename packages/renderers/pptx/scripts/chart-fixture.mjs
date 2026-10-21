// Original synthetic OOXML fixture. No external files, fonts or customer data.
export async function makePresentation(JSZip) {
  const zip = new JSZip();
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const xml = '<' + '?xml version="1.0" encoding="UTF-8" standalone="yes"?' + '>';
  const tree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
  const relationships = entries => xml + `<Relationships xmlns="${rels}">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
  const parts = [
    ['presentation.xml', 'presentation.main'],
    ['slideMasters/slideMaster1.xml', 'slideMaster'],
    ['slideLayouts/slideLayout1.xml', 'slideLayout'],
    ['theme/theme1.xml', 'theme'],
    ...[1, 2, 3].flatMap(i => [[`slides/slide${i}.xml`, 'slide'], [`charts/chart${i}.xml`, 'chart']])
  ];
  zip.file('[Content_Types].xml', xml + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${parts.map(([name, type]) => `<Override PartName="/ppt/${name}" ContentType="application/vnd.openxmlformats-officedocument.${type === 'theme' || type === 'chart' ? 'drawingml.' : 'presentationml.'}${type}+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', relationships([['rIdOffice', 'officeDocument', 'ppt/presentation.xml']]));
  zip.file('ppt/presentation.xml', xml + `<p:presentation xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst><p:sldIdLst>${[1, 2, 3].map(i => `<p:sldId id="${255 + i}" r:id="rIdSlide${i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', relationships([['rIdMaster', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...[1, 2, 3].map(i => [`rIdSlide${i}`, 'slide', `slides/slide${i}.xml`])]));
  zip.file('ppt/slideMasters/slideMaster1.xml', xml + `<p:sldMaster xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld>${tree}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships([['rIdLayout', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rIdTheme', 'theme', '../theme/theme1.xml']]));
  zip.file('ppt/slideLayouts/slideLayout1.xml', xml + `<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}" type="blank" preserve="1"><p:cSld>${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationships([['rIdMaster', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
  const colors = { dk1: '000000', lt1: 'FFFFFF', dk2: '222222', lt2: 'EEEEEE', accent1: 'FF0000', accent2: '00FF00', accent3: '0000FF', accent4: 'FFFF00', accent5: 'FF00FF', accent6: '00FFFF', hlink: '0000FF', folHlink: '800080' };
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const font = '<a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/>';
  zip.file('ppt/theme/theme1.xml', xml + `<a:theme xmlns:a="${a}" name="Synthetic chart theme"><a:themeElements><a:clrScheme name="Synthetic">${Object.entries(colors).map(([name, color]) => `<a:${name}><a:srgbClr val="${color}"/></a:${name}>`).join('')}</a:clrScheme><a:fontScheme name="Synthetic"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme><a:fmtScheme name="Synthetic"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${`<a:ln w="9525">${fill}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`);
  for (const i of [1, 2, 3]) {
    zip.file(`ppt/slides/slide${i}.xml`, xml + `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld>${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, relationships([['rIdLayout', 'slideLayout', '../slideLayouts/slideLayout1.xml']]));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
