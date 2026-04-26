import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InquiryForm } from './InquiryForm';

const ORIGINAL_LOCATION = window.location;

function setLocation(search: string) {
  // jsdom: replace window.location with a mutable copy
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...ORIGINAL_LOCATION, search, href: `http://localhost/${search}` },
  });
}

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return new Response(
        JSON.stringify({ id: 'inq-test-1', status: 'new' }),
        { status: 201 },
      );
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

function fillForm(values: Partial<{
  name: string; email: string; phone: string; checkIn: string;
  checkOut: string; message: string;
}>) {
  if (values.name !== undefined) {
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: values.name } });
  }
  if (values.email !== undefined) {
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: values.email } });
  }
  if (values.phone !== undefined) {
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: values.phone } });
  }
  if (values.checkIn !== undefined) {
    fireEvent.change(screen.getByLabelText(/check-in/i), { target: { value: values.checkIn } });
  }
  if (values.checkOut !== undefined) {
    fireEvent.change(screen.getByLabelText(/check-out/i), { target: { value: values.checkOut } });
  }
  if (values.message !== undefined) {
    fireEvent.change(screen.getByLabelText(/anything else/i), { target: { value: values.message } });
  }
}

describe('InquiryForm', () => {
  it('renders all required fields with proper labels', () => {
    render(<InquiryForm />);
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/check-in/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/check-out/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/anything else/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send inquiry/i })).toBeInTheDocument();
  });

  it('client-side validates checkOut > checkIn before hitting the API', async () => {
    render(<InquiryForm />);
    fillForm({
      name: 'Jane',
      email: 'jane@example.com',
      checkIn: '2026-07-15',
      checkOut: '2026-07-15', // same day
    });
    fireEvent.click(screen.getByRole('button', { name: /send inquiry/i }));
    await waitFor(() => {
      expect(screen.getByText(/check-out must be after check-in/i)).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('client-side validates email format', async () => {
    render(<InquiryForm />);
    fillForm({
      name: 'Jane',
      email: 'not-an-email',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
    });
    fireEvent.click(screen.getByRole('button', { name: /send inquiry/i }));
    await waitFor(() => {
      // Zod's "Valid email required" message
      expect(screen.getByText(/valid email required/i)).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits to the API and shows the success state', async () => {
    render(<InquiryForm />);
    fillForm({
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      message: 'Heading to Smith Rock',
    });
    fireEvent.click(screen.getByRole('button', { name: /send inquiry/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(screen.getByText(/we got it/i)).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      message: 'Heading to Smith Rock',
    });
  });

  it('pre-fills + locks date inputs when checkIn/checkOut are in the URL', async () => {
    setLocation('?checkIn=2026-07-15&checkOut=2026-07-18');
    render(<InquiryForm />);

    await waitFor(() => {
      expect(screen.getByLabelText(/check-in/i)).toHaveValue('2026-07-15');
    });
    expect(screen.getByLabelText(/check-out/i)).toHaveValue('2026-07-18');
    expect(screen.getByLabelText(/check-in/i)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/check-out/i)).toHaveAttribute('readonly');
    // Hint with the change-dates link
    expect(screen.getByRole('link', { name: /change dates/i })).toHaveAttribute(
      'href',
      '/book',
    );
  });

  it('ignores URL params with malformed dates (falls back to editable inputs)', async () => {
    setLocation('?checkIn=not-a-date&checkOut=2026-07-18');
    render(<InquiryForm />);

    // Inputs should be empty + editable
    expect(screen.getByLabelText(/check-in/i)).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText(/check-out/i)).not.toHaveAttribute('readonly');
    expect(screen.queryByRole('link', { name: /change dates/i })).not.toBeInTheDocument();
  });

  it('ignores URL params when checkOut <= checkIn', async () => {
    setLocation('?checkIn=2026-07-18&checkOut=2026-07-15');
    render(<InquiryForm />);
    expect(screen.getByLabelText(/check-in/i)).not.toHaveAttribute('readonly');
  });

  it('shows an error if the API rejects', async () => {
    fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Invalid request body.' } }),
        { status: 400 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<InquiryForm />);
    fillForm({
      name: 'Jane',
      email: 'jane@example.com',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
    });
    fireEvent.click(screen.getByRole('button', { name: /send inquiry/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid request body/i);
    });
  });
});
