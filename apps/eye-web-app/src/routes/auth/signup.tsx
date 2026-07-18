import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import {
  Button,
  InputField,
  Form,
  FormField,
  FormLabel,
  FormControl,
  getErrorMessage,
} from '@workspace/ui'
import { authClient } from '#/lib/auth-client'
import { ScanLineIcon } from '../auth'

export const Route = createFileRoute('/auth/signup')({
  component: SignupRoute,
})

const signupBaseSchema = z.object({
  name: z.string().min(1, 'Name is required').transform((s) => s.trim()),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address')
    .transform((s) => s.trim().toLowerCase()),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
})

const signupSchema = signupBaseSchema.refine(
  (data) => data.password === data.confirmPassword,
  {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  },
)

function SignupForm() {
  const [authError, setAuthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const form = useForm({
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
    validators: {
      onSubmit: signupSchema,
    },
    onSubmit: async ({ value }) => {
      setAuthError(null)
      setLoading(true)

      const { error } = await authClient.signUp.email({
        name: value.name,
        email: value.email,
        password: value.password,
      })

      setLoading(false)

      if (error) {
        setAuthError(error.message || 'Sign up failed')
        return
      }

      navigate({ to: '/' })
    },
  })

  return (
    <Form form={form} className="space-y-5" onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      <FormField
        name="name"
        validators={{
          onChange: signupBaseSchema.shape.name,
        }}
      >
        <FormLabel className="text-left">OPERATIVE_NAME</FormLabel>
        <FormControl>
          {(field) => {
            const err = getErrorMessage(field.state.meta.errors[0]);
            return (
              <InputField
                type="text"
                placeholder="Jane Doe"
                value={field.state.value as string}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                {...(err ? { error: err } : {})}
                icon={
                  <span className="material-symbols-outlined text-sm">badge</span>
                }
              />
            );
          }}
        </FormControl>
      </FormField>

      <FormField
        name="email"
        validators={{
          onChange: signupBaseSchema.shape.email,
        }}
      >
        <FormLabel className="text-left">EMAIL</FormLabel>
        <FormControl>
          {(field) => {
            const err = getErrorMessage(field.state.meta.errors[0]);
            return (
              <InputField
                type="email"
                placeholder="operative@the-eye.io"
                value={field.state.value as string}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                {...(err ? { error: err } : {})}
                icon={
                  <span className="material-symbols-outlined text-sm">mail</span>
                }
              />
            );
          }}
        </FormControl>
      </FormField>

      <FormField
        name="password"
        validators={{
          onChange: signupBaseSchema.shape.password,
        }}
      >
        <FormLabel className="text-left">PASSWORD</FormLabel>
        <FormControl>
          {(field) => {
            const err = getErrorMessage(field.state.meta.errors[0]);
            return (
              <InputField
                type="password"
                placeholder="••••••••••••"
                value={field.state.value as string}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                {...(err ? { error: err } : {})}
                icon={
                  <span className="material-symbols-outlined text-sm">lock</span>
                }
              />
            );
          }}
        </FormControl>
      </FormField>

      <FormField
        name="confirmPassword"
        validators={{
          onChange: signupBaseSchema.shape.confirmPassword,
        }}
      >
        <FormLabel className="text-left">CONFIRM_PASSWORD</FormLabel>
        <FormControl>
          {(field) => {
            const err = getErrorMessage(field.state.meta.errors[0]);
            return (
              <InputField
                type="password"
                placeholder="••••••••••••"
                value={field.state.value as string}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                {...(err ? { error: err } : {})}
                icon={
                  <span className="material-symbols-outlined text-sm">
                    lock_reset
                  </span>
                }
              />
            );
          }}
        </FormControl>
      </FormField>

      {authError && (
        <p className="font-mono text-xs text-destructive">{authError}</p>
      )}

      <form.Subscribe
        selector={(state) => [state.canSubmit, state.isSubmitting]}
      >
        {([canSubmit, isSubmitting]) => (
          <Button
            type="submit"
            variant="default"
            size="lg"
            className="w-full"
            disabled={!canSubmit || loading || isSubmitting}
          >
            {loading || isSubmitting ? 'REGISTERING...' : 'REGISTER'}
          </Button>
        )}
      </form.Subscribe>
    </Form>
  )
}

function SignupRoute() {
  return (
    <>
      <ScanLineIcon symbol="person_add" />

      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/60">
        NEW OPERATIVE REGISTRATION
      </span>

      <h1 className="font-mono text-4xl font-bold tracking-tight text-foreground leading-tight">
        REGISTER_YOUR
        <br />
        CREDENTIALS
      </h1>

      <p className="font-mono text-sm text-outline leading-relaxed max-w-sm">
        Create credentials to access the case intelligence platform. All
        accounts are encrypted end-to-end.
      </p>

      <div className="w-full pt-2">
        <SignupForm />
      </div>

      <div className="text-center">
        <Link
          to="/auth/login"
          className="font-mono text-xs uppercase tracking-wider text-outline hover:text-primary transition-colors duration-500"
        >
          ALREADY_HAVE_ACCESS
        </Link>
      </div>
    </>
  )
}
