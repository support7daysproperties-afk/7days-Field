import { describe, it, expect } from 'vitest';
import {
  generatePhotoSphereXmpXml,
  injectXmpIntoJpeg,
  extractGPanoMetadataFromJpeg,
} from '../src/features/photo-sphere/PhotoSphereXMP';
import { PhotoSphereStitcher } from '../src/features/photo-sphere/PhotoSphereStitcher';

// Minimal valid JPEG binary generator for testing
function createDummyJpeg() {
  // SOI (0xFF, 0xD8), DQT (0xFF, 0xDB, len=5, dummy...), SOF0, SOS, EOI (0xFF, 0xD9)
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0 (JFIF) len 16
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xdb, 0x00, 0x07, 0x00, 0x01, 0x02, 0x03, 0x04, // DQT
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01, 0x01, 0x11, 0x00, // SOF0
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS
    0xaa, 0xbb, // Image data
    0xff, 0xd9, // EOI
  ]);
}

describe('PhotoSphereXMP Suite (Milestone 2)', () => {
  it('should generate valid Google Photo Sphere XMP XML with full sphere parameters', () => {
    const xml = generatePhotoSphereXmpXml({
      fullPanoWidth: 2048,
      fullPanoHeight: 1024,
      croppedWidth: 2048,
      croppedHeight: 1024,
      croppedLeft: 0,
      croppedTop: 0,
      isCompleteSphere: true,
      sourcePhotosCount: 30,
      headingDegrees: 90,
    });

    expect(xml).toContain('xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"');
    expect(xml).toContain('<GPano:UsePanoramaViewer>True</GPano:UsePanoramaViewer>');
    expect(xml).toContain('<GPano:IsPhotosphere>True</GPano:IsPhotosphere>');
    expect(xml).toContain('<GPano:ProjectionType>equirectangular</GPano:ProjectionType>');
    expect(xml).toContain('<GPano:FullPanoWidthPixels>2048</GPano:FullPanoWidthPixels>');
    expect(xml).toContain('<GPano:FullPanoHeightPixels>1024</GPano:FullPanoHeightPixels>');
    expect(xml).toContain('<GPano:CroppedAreaImageWidthPixels>2048</GPano:CroppedAreaImageWidthPixels>');
    expect(xml).toContain('<GPano:CroppedAreaImageHeightPixels>1024</GPano:CroppedAreaImageHeightPixels>');
    expect(xml).toContain('<GPano:CroppedAreaLeftPixels>0</GPano:CroppedAreaLeftPixels>');
    expect(xml).toContain('<GPano:CroppedAreaTopPixels>0</GPano:CroppedAreaTopPixels>');
    expect(xml).toContain('<GPano:InitialViewHeadingDegrees>90</GPano:InitialViewHeadingDegrees>');
    expect(xml).toContain('<GPano:SourcePhotosCount>30</GPano:SourcePhotosCount>');
  });

  it('should accurately reflect partial spherical panoramas in XMP crop tags', () => {
    const xml = generatePhotoSphereXmpXml({
      fullPanoWidth: 2048,
      fullPanoHeight: 1024,
      croppedWidth: 2048,
      croppedHeight: 600,
      croppedLeft: 0,
      croppedTop: 212,
      isCompleteSphere: false,
      sourcePhotosCount: 12,
    });

    expect(xml).toContain('<GPano:IsPhotosphere>False</GPano:IsPhotosphere>');
    expect(xml).toContain('<GPano:FullPanoWidthPixels>2048</GPano:FullPanoWidthPixels>');
    expect(xml).toContain('<GPano:FullPanoHeightPixels>1024</GPano:FullPanoHeightPixels>');
    expect(xml).toContain('<GPano:CroppedAreaImageHeightPixels>600</GPano:CroppedAreaImageHeightPixels>');
    expect(xml).toContain('<GPano:CroppedAreaTopPixels>212</GPano:CroppedAreaTopPixels>');
  });

  it('should inject APP1 XMP segment into JPEG without corrupting binary structure', () => {
    const originalJpeg = createDummyJpeg();
    expect(originalJpeg[0]).toBe(0xff);
    expect(originalJpeg[1]).toBe(0xd8); // SOI

    const injectedJpeg = injectXmpIntoJpeg(originalJpeg, {
      fullPanoWidth: 2048,
      fullPanoHeight: 1024,
      croppedWidth: 2048,
      croppedHeight: 1024,
      isCompleteSphere: true,
      sourcePhotosCount: 30,
    });

    // Valid JPEG markers intact
    expect(injectedJpeg[0]).toBe(0xff);
    expect(injectedJpeg[1]).toBe(0xd8); // SOI preserved
    expect(injectedJpeg[injectedJpeg.length - 2]).toBe(0xff);
    expect(injectedJpeg[injectedJpeg.length - 1]).toBe(0xd9); // EOI preserved

    // Size increased by APP1 header and payload
    expect(injectedJpeg.length).toBeGreaterThan(originalJpeg.length);
  });

  it('should extract and parse injected GPano metadata accurately from JPEG', () => {
    const originalJpeg = createDummyJpeg();
    const injectedJpeg = injectXmpIntoJpeg(originalJpeg, {
      fullPanoWidth: 4096,
      fullPanoHeight: 2048,
      croppedWidth: 4096,
      croppedHeight: 1800,
      croppedLeft: 0,
      croppedTop: 124,
      isCompleteSphere: false,
      sourcePhotosCount: 22,
    });

    const parsed = extractGPanoMetadataFromJpeg(injectedJpeg);
    expect(parsed).not.toBeNull();
    expect(parsed.usePanoramaViewer).toBe(true);
    expect(parsed.isPhotosphere).toBe(false);
    expect(parsed.projectionType).toBe('equirectangular');
    expect(parsed.fullPanoWidthPixels).toBe(4096);
    expect(parsed.fullPanoHeightPixels).toBe(2048);
    expect(parsed.croppedAreaImageWidthPixels).toBe(4096);
    expect(parsed.croppedAreaImageHeightPixels).toBe(1800);
    expect(parsed.croppedAreaLeftPixels).toBe(0);
    expect(parsed.croppedAreaTopPixels).toBe(124);
    expect(parsed.sourcePhotosCount).toBe(22);
  });
});

describe('PhotoSphereStitcher & Coverage Suite (Milestone 3)', () => {
  it('should evaluate partial vs complete spherical coverage correctly', () => {
    // 1. Partial equatorial horizon ring only (10 shots, no zenith/nadir)
    const partialFrames = Array.from({ length: 10 }, (_, i) => ({
      yaw: i * 36,
      pitch: 0,
    }));
    const partialCoverage = PhotoSphereStitcher.evaluateCoverage(partialFrames);
    expect(partialCoverage.isCompleteSphere).toBe(false);
    expect(partialCoverage.hasZenith).toBe(false);
    expect(partialCoverage.hasNadir).toBe(false);
    expect(partialCoverage.minPitch).toBe(0);
    expect(partialCoverage.maxPitch).toBe(0);

    // 2. Full 30-shot spherical capture grid
    const fullFrames = [
      ...Array.from({ length: 10 }, (_, i) => ({ yaw: i * 36, pitch: 0 })),
      ...Array.from({ length: 8 }, (_, i) => ({ yaw: i * 45, pitch: 35 })),
      { yaw: 0, pitch: 78 },
      { yaw: 180, pitch: 78 },
      ...Array.from({ length: 8 }, (_, i) => ({ yaw: i * 45, pitch: -35 })),
      { yaw: 0, pitch: -78 },
      { yaw: 180, pitch: -78 },
    ];
    const fullCoverage = PhotoSphereStitcher.evaluateCoverage(fullFrames);
    expect(fullCoverage.isCompleteSphere).toBe(true);
    expect(fullCoverage.hasZenith).toBe(true);
    expect(fullCoverage.hasNadir).toBe(true);
    expect(fullCoverage.minPitch).toBe(-78);
    expect(fullCoverage.maxPitch).toBe(78);
  });
});
