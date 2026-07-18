import * as React from "react"
import type { AnyFieldApi } from "@tanstack/react-form"

import { cn } from "../../lib/utils"

// Extract error message from various error formats (Zod, string, etc.)
function getErrorMessage(error: unknown): string | null {
  if (!error) return null
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

// Form API type that includes React-specific components (Field, Subscribe)
interface FormApiLike {
  Field: React.ComponentType<{
    name: string
    children: (field: AnyFieldApi) => React.ReactNode
    validators?: Record<string, unknown>
  }>
  Subscribe: React.ComponentType<{
    selector?: (state: unknown) => unknown
    children: ((state: unknown) => React.ReactNode) | React.ReactNode
  }>
  handleSubmit: () => void
  state: { values: Record<string, unknown> }
}

// Form Context
interface FormContextValue {
  form: FormApiLike
}

const FormContext = React.createContext<FormContextValue | null>(null)

function useFormContext() {
  const context = React.useContext(FormContext)
  if (!context) {
    throw new Error("Form components must be used within a <Form> provider")
  }
  return context
}

// Field Context
interface FormFieldContextValue {
  field: AnyFieldApi
  name: string
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

function useFormFieldContext() {
  const context = React.useContext(FormFieldContext)
  if (!context) {
    throw new Error("Form field components must be used within a <FormField> provider")
  }
  return context
}

// Form
export interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  form: FormApiLike
}

const Form = React.forwardRef<HTMLFormElement, FormProps>(
  ({ form, className, children, ...props }, ref) => {
    return (
      <FormContext.Provider value={{ form }}>
        <form
          ref={ref}
          className={cn("space-y-4", className)}
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            form.handleSubmit()
          }}
          {...props}
        >
          {children}
        </form>
      </FormContext.Provider>
    )
  }
)
Form.displayName = "Form"

// FormField
export interface FormFieldProps {
  name: string
  children: React.ReactNode
  validators?: {
    onChange?: (value: unknown) => unknown
    onBlur?: (value: unknown) => unknown
    onSubmit?: (value: unknown) => unknown
  }
}

function FormField({ name, children, validators }: FormFieldProps) {
  const { form } = useFormContext()
  const Field = form.Field

  return (
    <Field name={name} validators={validators ?? {}}>
      {(field: AnyFieldApi) => (
        <FormFieldContext.Provider value={{ field, name }}>
          {children}
        </FormFieldContext.Provider>
      )}
    </Field>
  )
}

// FormLabel
export interface FormLabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {}

const FormLabel = React.forwardRef<HTMLLabelElement, FormLabelProps>(
  ({ className, children, ...props }, ref) => {
    const { name, field } = useFormFieldContext()
    const hasError = field.state.meta.errors.length > 0

    return (
      <label
        ref={ref}
        htmlFor={name}
        className={cn(
          "block font-mono text-xs font-medium uppercase tracking-widest",
          hasError ? "text-destructive" : "text-muted-foreground",
          className
        )}
        {...props}
      >
        {children}
      </label>
    )
  }
)
FormLabel.displayName = "FormLabel"

// FormControl
export interface FormControlProps {
  children: (field: AnyFieldApi) => React.ReactNode
}

function FormControl({ children }: FormControlProps) {
  const { field } = useFormFieldContext()
  return <>{children(field)}</>
}

// FormMessage
export interface FormMessageProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

const FormMessage = React.forwardRef<HTMLParagraphElement, FormMessageProps>(
  ({ className, children, ...props }, ref) => {
    const { field } = useFormFieldContext()
    const errors = field.state.meta.errors
    const message = errors.length > 0 ? getErrorMessage(errors[0]) : children

    if (!message) return null

    return (
      <p
        ref={ref}
        className={cn("font-mono text-xs text-destructive", className)}
        {...props}
      >
        {message}
      </p>
    )
  }
)
FormMessage.displayName = "FormMessage"

// FormDescription
export interface FormDescriptionProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

const FormDescription = React.forwardRef<HTMLParagraphElement, FormDescriptionProps>(
  ({ className, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn("font-mono text-xs text-outline", className)}
        {...props}
      />
    )
  }
)
FormDescription.displayName = "FormDescription"

export {
  Form,
  FormField,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
  useFormContext,
  useFormFieldContext,
  getErrorMessage,
}
