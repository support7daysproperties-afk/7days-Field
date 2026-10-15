/**
 * GPanoMetadata.js
 *
 * Lossless client-side injector for Google Photo Sphere (GPano) XMP metadata.
 * Directly splices an APP1 XMP marker into the JPEG stream without recompressing,
 * guaranteeing zero generational quality loss.
 *
 * Conforms to Google Photo Sphere XMP metadata specifications:
 * - ProjectionType = "equirectangular"
 * - UsePanoramaViewer = "True"
 * - CroppedAreaImageWidthPixels
 * - CroppedAreaImageHeightPixels
 * - FullPanoWidthPixels
 * - FullPanoHeightPixels
 * - CroppedAreaLeftPixels = 0
 * - CroppedAreaTopPixels = 0
 */

/**
 * Builds the XMP RDF XML packet containing GPano metadata.
 * @param {object} params
 * @param {number} params.fullWidth - Full 360 sphere width (e.g. 4096)
 * @param {number} params.fullHeight - Full 180 sphere height (e.g. 2048)
 * @param {number} [params.croppedWidth] - Actually captured width
 * @param {number} [params.croppedHeight] - Actually captured height
 * @param {number} [params.croppedLeft=0]
 * @param {number} [params.croppedTop=0]
 * @returns {string} XML string
 */
export function buildGPanoXmpPacket({
  fullWidth,
  fullHeight,
  croppedWidth = fullWidth,
  croppedHeight = fullHeight,
  croppedLeft = 0,
  croppedTop = 0,
}) {
  return (
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.0-jc003">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/">` +
    `<GPano:UsePanoramaViewer>True</GPano:UsePanoramaViewer>` +
    `<GPano:ProjectionType>equirectangular</GPano:ProjectionType>` +
    `<GPano:FullPanoWidthPixels>${fullWidth}</GPano:FullPanoWidthPixels>` +
    `<GPano:FullPanoHeightPixels>${fullHeight}</GPano:FullPanoHeightPixels>` +
    `<GPano:CroppedAreaImageWidthPixels>${croppedWidth}</GPano:CroppedAreaImageWidthPixels>` +
    `<GPano:CroppedAreaImageHeightPixels>${croppedHeight}</GPano:CroppedAreaImageHeightPixels>` +
    `<GPano:CroppedAreaLeftPixels>${croppedLeft}</GPano:CroppedAreaLeftPixels>` +
    `<GPano:CroppedAreaTopPixels>${croppedTop}</GPano:CroppedAreaTopPixels>` +
    `</rdf:Description>` +
    `</rdf:RDF>` +
    `</x:xmpmeta>`
  );
}

/**
 * Injects a GPano XMP APP1 segment into a JPEG ArrayBuffer or Blob.
 *
 * @param {ArrayBuffer} jpegBuffer
 * @param {object} panoMeta
 * @returns {ArrayBuffer} Modified JPEG ArrayBuffer
 */
export function injectGPanoMetadata(jpegBuffer, panoMeta) {
  const bytes = new Uint8Array(jpegBuffer);

  // Validate SOI marker (0xFF, 0xD8)
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Invalid JPEG format: Missing SOI marker (0xFFD8)');
  }

  const xmpHeader = 'http://ns.adobe.com/xap/1.0/\0';
  const xmpPacket = buildGPanoXmpPacket(panoMeta);
  const encoder = new TextEncoder();
  const xmpData = encoder.encode(xmpHeader + xmpPacket);

  // APP1 marker (0xFF, 0xE1) + 2 bytes length (length includes length bytes themselves)
  const app1Length = xmpData.length + 2;
  const app1Segment = new Uint8Array(4 + xmpData.length);
  app1Segment[0] = 0xff;
  app1Segment[1] = 0xe1;
  app1Segment[2] = (app1Length >> 8) & 0xff;
  app1Segment[3] = app1Length & 0xff;
  app1Segment.set(xmpData, 4);

  // Find insertion point right after SOI (index 2) or after existing JFIF APP0 marker
  let insertPos = 2;
  if (bytes[2] === 0xff && bytes[3] === 0xe0) {
    // Has APP0 segment: skip it
    const app0Len = (bytes[4] << 8) | bytes[5];
    insertPos = 4 + app0Len;
  }

  // Combine: [SOI + APP0] + [New APP1 with GPano] + [Remaining JPEG]
  const result = new Uint8Array(bytes.length + app1Segment.length);
  result.set(bytes.subarray(0, insertPos), 0);
  result.set(app1Segment, insertPos);
  result.set(bytes.subarray(insertPos), insertPos + app1Segment.length);

  return result.buffer;
}
