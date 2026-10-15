/**
 * PhotoSphereXMP.js
 *
 * Implements Google Photo Sphere XMP metadata generation, JPEG APP1 segment injection,
 * and binary validation for equirectangular spherical panoramas.
 *
 * Conforms to Google Photo Sphere XMP Specification:
 * - Namespace URI: http://ns.google.com/photos/1.0/panorama/
 * - Namespace Prefix: GPano
 *
 * Key fields:
 * - GPano:UsePanoramaViewer="True"
 * - GPano:IsPhotosphere="True" | "False"
 * - GPano:ProjectionType="equirectangular"
 * - GPano:FullPanoWidthPixels
 * - GPano:FullPanoHeightPixels
 * - GPano:CroppedAreaImageWidthPixels
 * - GPano:CroppedAreaImageHeightPixels
 * - GPano:CroppedAreaLeftPixels
 * - GPano:CroppedAreaTopPixels
 * - GPano:InitialViewHeadingDegrees
 * - GPano:InitialViewPitchDegrees
 * - GPano:InitialViewRollDegrees
 * - GPano:SourcePhotosCount
 */

const XMP_NAMESPACE_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

/**
 * Builds the standard Google Photo Sphere RDF/XMP XML string.
 *
 * @param {object} params
 * @param {number} params.fullPanoWidth Full 360° sphere width in pixels
 * @param {number} params.fullPanoHeight Full 180° sphere height in pixels (must be fullPanoWidth / 2)
 * @param {number} params.croppedWidth Width of the rendered image
 * @param {number} params.croppedHeight Height of the rendered image
 * @param {number} [params.croppedLeft=0] Left offset of the crop in full panorama
 * @param {number} [params.croppedTop=0] Top offset of the crop in full panorama
 * @param {boolean} [params.isCompleteSphere=true] Whether this represents a full 360x180 sphere
 * @param {number} [params.sourcePhotosCount=30] Number of frames contributing to panorama
 * @param {number} [params.headingDegrees=0] Initial viewing heading
 * @returns {string} XMP XML packet
 */
export function generatePhotoSphereXmpXml({
  fullPanoWidth,
  fullPanoHeight,
  croppedWidth,
  croppedHeight,
  croppedLeft = 0,
  croppedTop = 0,
  isCompleteSphere = true,
  sourcePhotosCount = 30,
  headingDegrees = 0,
}) {
  const isPhotosphereStr = isCompleteSphere ? 'True' : 'False';

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:GPano="http://ns.google.com/photos/1.0/panorama/">
      <GPano:UsePanoramaViewer>True</GPano:UsePanoramaViewer>
      <GPano:IsPhotosphere>${isPhotosphereStr}</GPano:IsPhotosphere>
      <GPano:ProjectionType>equirectangular</GPano:ProjectionType>
      <GPano:FullPanoWidthPixels>${Math.round(fullPanoWidth)}</GPano:FullPanoWidthPixels>
      <GPano:FullPanoHeightPixels>${Math.round(fullPanoHeight)}</GPano:FullPanoHeightPixels>
      <GPano:CroppedAreaImageWidthPixels>${Math.round(croppedWidth)}</GPano:CroppedAreaImageWidthPixels>
      <GPano:CroppedAreaImageHeightPixels>${Math.round(croppedHeight)}</GPano:CroppedAreaImageHeightPixels>
      <GPano:CroppedAreaLeftPixels>${Math.round(croppedLeft)}</GPano:CroppedAreaLeftPixels>
      <GPano:CroppedAreaTopPixels>${Math.round(croppedTop)}</GPano:CroppedAreaTopPixels>
      <GPano:InitialViewHeadingDegrees>${Math.round(headingDegrees)}</GPano:InitialViewHeadingDegrees>
      <GPano:InitialViewPitchDegrees>0</GPano:InitialViewPitchDegrees>
      <GPano:InitialViewRollDegrees>0</GPano:InitialViewRollDegrees>
      <GPano:SourcePhotosCount>${Math.round(sourcePhotosCount)}</GPano:SourcePhotosCount>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Injects a Google Photo Sphere XMP APP1 segment into a JPEG ArrayBuffer or Uint8Array.
 * Preserves standard JPEG structure (SOI -> APP1 -> remaining markers/data).
 *
 * @param {Uint8Array|ArrayBuffer} jpegData Original JPEG binary
 * @param {object} xmpParams Parameter object for generatePhotoSphereXmpXml
 * @returns {Uint8Array} Modified JPEG binary containing APP1 XMP segment
 */
export function injectXmpIntoJpeg(jpegData, xmpParams) {
  const bytes = jpegData instanceof Uint8Array ? jpegData : new Uint8Array(jpegData);

  // Validate JPEG SOI (0xFF 0xD8)
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Invalid JPEG binary: Missing SOI marker (0xFFD8)');
  }

  // Generate XMP XML
  const xmpXml = generatePhotoSphereXmpXml(xmpParams);
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(XMP_NAMESPACE_HEADER);
  const xmlBytes = encoder.encode(xmpXml);

  const payloadLength = headerBytes.length + xmlBytes.length;
  // APP1 marker length includes 2 bytes for the length field itself
  const app1Length = payloadLength + 2;

  if (app1Length > 65535) {
    throw new Error(`XMP packet too large for single APP1 segment (${app1Length} bytes)`);
  }

  // Build the APP1 segment: 0xFF, 0xE1, lenMSB, lenLSB, payload...
  const app1Segment = new Uint8Array(2 + app1Length);
  app1Segment[0] = 0xff;
  app1Segment[1] = 0xe1; // APP1
  app1Segment[2] = (app1Length >> 8) & 0xff;
  app1Segment[3] = app1Length & 0xff;
  app1Segment.set(headerBytes, 4);
  app1Segment.set(xmlBytes, 4 + headerBytes.length);

  // We want to insert APP1 right after SOI (index 2) or after existing JFIF/EXIF APP0/APP1 if present.
  // Standard position is right after SOI or after existing APP0 (JFIF).
  let insertPos = 2;
  if (bytes.length > 4 && bytes[2] === 0xff && bytes[3] === 0xe0) {
    // There is an APP0 marker: skip past it
    const app0Len = (bytes[4] << 8) | bytes[5];
    insertPos = 4 + app0Len;
  }

  // Combine into single Uint8Array
  const output = new Uint8Array(bytes.length + app1Segment.length);
  output.set(bytes.subarray(0, insertPos), 0);
  output.set(app1Segment, insertPos);
  output.set(bytes.subarray(insertPos), insertPos + app1Segment.length);

  return output;
}

/**
 * Extracts and parses GPano XMP metadata from a JPEG Uint8Array or ArrayBuffer.
 * Used for automated verification and regression testing.
 *
 * @param {Uint8Array|ArrayBuffer} jpegData
 * @returns {object|null} Parsed GPano fields or null if not found
 */
export function extractGPanoMetadataFromJpeg(jpegData) {
  const bytes = jpegData instanceof Uint8Array ? jpegData : new Uint8Array(jpegData);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = bytes[offset + 1];
    // Stop at SOS (Start of Scan 0xDA) or EOI (0xD9)
    if (marker === 0xda || marker === 0xd9) break;

    const len = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (len < 2 || offset + 2 + len > bytes.length) break;

    if (marker === 0xe1) {
      // APP1 segment
      const segmentData = bytes.subarray(offset + 4, offset + 2 + len);
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(segmentData);

      if (text.includes('http://ns.adobe.com/xap/1.0/') && text.includes('http://ns.google.com/photos/1.0/panorama/')) {
        // Extract GPano tags
        const extractTag = (tag) => {
          const match = text.match(new RegExp(`<GPano:${tag}>([^<]+)</GPano:${tag}>`));
          return match ? match[1] : null;
        };

        const extractNum = (tag) => {
          const val = extractTag(tag);
          return val !== null ? Number(val) : null;
        };

        return {
          usePanoramaViewer: extractTag('UsePanoramaViewer') === 'True',
          isPhotosphere: extractTag('IsPhotosphere') === 'True',
          projectionType: extractTag('ProjectionType'),
          fullPanoWidthPixels: extractNum('FullPanoWidthPixels'),
          fullPanoHeightPixels: extractNum('FullPanoHeightPixels'),
          croppedAreaImageWidthPixels: extractNum('CroppedAreaImageWidthPixels'),
          croppedAreaImageHeightPixels: extractNum('CroppedAreaImageHeightPixels'),
          croppedAreaLeftPixels: extractNum('CroppedAreaLeftPixels'),
          croppedAreaTopPixels: extractNum('CroppedAreaTopPixels'),
          sourcePhotosCount: extractNum('SourcePhotosCount'),
          rawXml: text,
        };
      }
    }

    offset += 2 + len;
  }

  return null;
}
