/**
 * Supabase Database Schema Definitions and Types
 * Matches the public schema in Supabase project: wyemgcechinofytutqhj
 */

/**
 * Valid database enums
 */
export const DB_ENUMS = {
  sync_status: ['LOCAL_ONLY', 'PENDING_UPLOAD', 'UPLOADING', 'UPLOADED', 'FAILED'],
  inspection_status: ['PENDING', 'IN_PROGRESS', 'COMPLETED'],
};

/**
 * Allowed columns for public.field_inspections table
 */
export const FIELD_INSPECTION_COLUMNS = [
  'id',
  'property_id',
  'supervisor_id',
  'task_id',
  'status',
  'sync_status',
  'checklist',
  'remarks',
  'owner_name',
  'owner_phone',
  'consent_given',
  'signature_url',
  'created_at',
  'updated_at',
];

/**
 * Allowed columns for public.field_supervisors table
 */
export const FIELD_SUPERVISOR_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'auth_user_id',
  'created_at',
  'updated_at',
];

/**
 * Helper to check if a string is a valid UUID v4
 * @param {string} str 
 * @returns {boolean}
 */
export function isValidUUID(str) {
  if (typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}
