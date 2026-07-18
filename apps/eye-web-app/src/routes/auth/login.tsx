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

export const Route = createFileRoute('/auth/login')({
  component: LoginRoute,
})

const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address')
    .transform((s) => s.trim().toLowerCase()),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters'),
})

function LoginForm() {
  const [authError, setAuthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
    },
    onSubmit: async ({ value }) => {
      setAuthError(null)
      setLoading(true)

      const { error } = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      })

      setLoading(false)

      if (error) {
        setAuthError(error.message || 'Authentication failed')
        return
      }

      const redirectTo = sessionStorage.getItem('redirectTo') || '/'
      sessionStorage.removeItem('redirectTo')
      navigate({ to: redirectTo })
    },
  })

  return (
    <Form form={form} className="space-y-5">
      <FormField
        name="email"
        validators={{
          onChange: loginSchema.shape.email,
        }}
      >
        <FormLabel className="text-left">EMAIL</FormLabel>
        <FormControl>
          {(field) => (
            <InputField
              type="email"
              placeholder="operative@the-eye.io"
              value={field.state.value as string}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              error={getErrorMessage(field.state.meta.errors[0]) ?? undefined}
              icon={
                <span className="material-symbols-outlined text-sm">mail</span>
              }
            />
          )}
        </FormControl>
      </FormField>

      <FormField
        name="password"
        validators={{
          onChange: loginSchema.shape.password,
        }}
      >
        <FormLabel className="text-left">PASSWORD</FormLabel>
        <FormControl>
          {(field) => (
            <InputField
              type="password"
              placeholder="••••••••••••"
              value={field.state.value as string}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              error={getErrorMessage(field.state.meta.errors[0]) ?? undefined}
              icon={
                <span className="material-symbols-outlined text-sm">lock</span>
              }
            />
          )}
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
            {loading || isSubmitting ? 'AUTHENTICATING...' : 'AUTHENTICATE'}
          </Button>
        )}
      </form.Subscribe>
    </Form>
  )
}

function LoginRoute() {
  return (
    <>
      <ScanLineIcon symbol="fingerprint" />

      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary/60">
        SECURE ACCESS PORTAL
      </span>

      <h1 className="font-mono text-4xl font-bold tracking-tight text-foreground leading-tight">
        DEPLOY_YOUR
        <br />
        PARALEGAL_OPS
      </h1>

      <p className="font-mono text-sm text-outline leading-relaxed max-w-sm">
        Authenticate to access the case intelligence platform. All sessions are
        encrypted end-to-end.
      </p>

      <div className="w-full pt-2">
        <LoginForm />
      </div>

      <div className="text-center">
        <Link
          to="/auth/signup"
          className="font-mono text-xs uppercase tracking-wider text-outline hover:text-primary transition-colors duration-500"
        >
          REQUEST_ACCESS_CREDENTIALS
        </Link>
      </div>
    </>
  )
}
