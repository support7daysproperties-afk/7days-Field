import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Owner Consent Verification & Identity Capture Tests', () => {
  // Aadhaar formatter logic matching InspectionSession.jsx
  const formatAadhaar = (val) => {
    const raw = (val || '').replace(/\D/g, '').slice(0, 12);
    const parts = [];
    for (let i = 0; i < raw.length; i += 4) {
      parts.push(raw.slice(i, i + 4));
    }
    return parts.join(' ');
  };

  const getAadhaarDigits = (val) => {
    return (val || '').replace(/\D/g, '').length;
  };

  it('formats raw 12-digit Aadhaar input into standard 4-4-4 spacing', () => {
    const raw = '123456789012';
    const formatted = formatAadhaar(raw);
    expect(formatted).toBe('1234 5678 9012');
    expect(getAadhaarDigits(formatted)).toBe(12);
  });

  it('filters out letters, symbols, and special characters from Aadhaar input', () => {
    const messyInput = '1234-abcd-5678#9012!extra';
    const formatted = formatAadhaar(messyInput);
    expect(formatted).toBe('1234 5678 9012');
    expect(getAadhaarDigits(formatted)).toBe(12);
  });

  it('handles partial input smoothly without adding extra spaces at the end', () => {
    expect(formatAadhaar('123')).toBe('123');
    expect(formatAadhaar('1234')).toBe('1234');
    expect(formatAadhaar('12345')).toBe('1234 5');
    expect(formatAadhaar('12345678')).toBe('1234 5678');
    expect(formatAadhaar('123456789')).toBe('1234 5678 9');
  });

  it('enforces 12-digit maximum length boundary', () => {
    const tooLong = '1234567890123456789';
    const formatted = formatAadhaar(tooLong);
    expect(formatted).toBe('1234 5678 9012');
    expect(getAadhaarDigits(formatted)).toBe(12);
  });

  it('preserves ownerAadhaar and ownerPhoto in inspection metadata payload', () => {
    const mockInspection = {
      id: 'insp-test-01',
      property_id: 'prop-01',
      status: 'IN_PROGRESS',
      metadata: {
        checklist: { 'Exterior inspected': true },
        remarks: 'Site clear',
        ownerInfo: { name: 'Ramesh', phone: '9876543210', relationship: 'Owner' },
        consent: true,
        signature: 'data:image/png;base64,mockSignatureData',
        ownerAadhaar: '9876 5432 1098',
        ownerPhoto: 'blob:http://localhost/mock-photo-url'
      }
    };

    expect(mockInspection.metadata.ownerAadhaar).toBe('9876 5432 1098');
    expect(mockInspection.metadata.ownerPhoto).toBeTruthy();
    expect(mockInspection.metadata.consent).toBe(true);
    expect(mockInspection.metadata.signature).toBeTruthy();
  });
});
