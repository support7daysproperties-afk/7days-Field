-- Migration: Field Inspections and Supervisors Schema Definition
-- Verified against live database schema and PostgREST API
-- Reference: 7Days Field Mobile App Synchronization

-- 1. Create Enums if they do not exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_status') THEN
    CREATE TYPE sync_status AS ENUM (
      'LOCAL_ONLY',
      'PENDING_UPLOAD',
      'UPLOADING',
      'UPLOADED',
      'FAILED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inspection_status') THEN
    CREATE TYPE inspection_status AS ENUM (
      'PENDING',
      'IN_PROGRESS',
      'COMPLETED'
    );
  END IF;
END $$;

-- 2. Field Supervisors table
-- Note: auth_user_id belongs in field_supervisors, linking to auth.users(id)
CREATE TABLE IF NOT EXISTS public.field_supervisors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  name text,
  email text,
  phone text,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_field_supervisors_auth_user_id ON public.field_supervisors(auth_user_id);

-- 3. Field Inspections table
-- Note: field_inspections references supervisor_id (field_supervisors.id), NOT auth_user_id directly.
CREATE TABLE IF NOT EXISTS public.field_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid,
  supervisor_id uuid REFERENCES public.field_supervisors(id) ON DELETE SET NULL,
  task_id uuid,
  status inspection_status DEFAULT 'COMPLETED',
  sync_status sync_status DEFAULT 'UPLOADING',
  checklist jsonb,
  remarks text,
  owner_name text,
  owner_phone text,
  consent_given boolean DEFAULT false,
  signature_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_inspections_supervisor_id ON public.field_inspections(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_field_inspections_property_id ON public.field_inspections(property_id);
CREATE INDEX IF NOT EXISTS idx_field_inspections_sync_status ON public.field_inspections(sync_status);

-- 4. Row Level Security Policies
ALTER TABLE public.field_inspections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'field_inspections' AND policyname = 'Supervisors can manage own inspections'
  ) THEN
    CREATE POLICY "Supervisors can manage own inspections"
      ON public.field_inspections
      FOR ALL
      TO authenticated
      USING (
        supervisor_id IN (
          SELECT id FROM public.field_supervisors WHERE auth_user_id = auth.uid()
        )
        OR supervisor_id = auth.uid()
      )
      WITH CHECK (
        supervisor_id IN (
          SELECT id FROM public.field_supervisors WHERE auth_user_id = auth.uid()
        )
        OR supervisor_id = auth.uid()
      );
  END IF;
END $$;
