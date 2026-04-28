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

const PROPERTY_FIXTURE = {
  id: 'p1',
  name: "The Owl's Nest",
  address: '147 SW 4th St, Redmond, OR',
  minStay: 2,
  maxGuests: 4,
  checkInTime: '15:00',
  checkOutTime: '11:00',
  baseNightlyRate: 200,
  cleaningFee: 0,
  cancellationPolicy: 'tiered',
};

const QUOTE_FIXTURE = {
  checkIn: '2026-07-15',
  checkOut: '2026-07-18',
  numberOfNights: 3,
  nightlyRate: 200,
  subtotal: 600,
  taxes: {
    stateTlt: { label: 'Oregon TLT', rate: 0.015, amount: 9 },
    cityTlt: { label: 'Redmond TLT', rate: 0.09, amount: 54 },
    totalTax: 63,
  },
  total: 663,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return new Response(
        JSON.stringify({ id: 'inq-test-1', status: 'new' }),
        { status: 201 },
      );
    }
    if (typeof input === 'string' && input.includes('/api/v1/property')) {
      return new Response(JSON.stringify(PROPERTY_FIXTURE), { status: 200 });
    }
    if (typeof input === 'string' && input.includes('/api/v1/pricing/quote')) {
      return new Response(JSON.stringify(QUOTE_FIXTURE), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

function fillForm(values: Partial<{
  name: string; email: string; phone: string; checkIn: string;
  checkOut: string; numGuests: number; message: string;
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
  if (values.numGuests !== undefined) {
    fireEvent.change(screen.getByLabelText(/number of guests/i), {
      target: { value: String(values.numGuests) },
    });
  }
  if (values.message !== undefined) {
    fireEvent.change(screen.getByLabelText(/what brings you to central oregon/i), { target: { value: values.message } });
  }
}

function postCalls(): RequestInit[] {
  return fetchMock.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
    .map((c) => c[1] as RequestInit);
}

describe('InquiryForm', () => {
  it('every form control has an associated accessible label (a11y audit)', () => {
    const { container } = render(<InquiryForm />);
    const controls = container.querySelectorAll('input, select, textarea');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of Array.from(controls)) {
      expect(control).toHaveAccessibleName();
    }
  });

  it('renders all required fields with proper labels', () => {
    render(<InquiryForm />);
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/check-in/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/check-out/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/number of guests/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/planning to bring a dog/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what brings you to central oregon/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send booking request/i })).toBeInTheDocument();
  });

  it('reveals dog-count selector + pet rules link when the pet checkbox is checked', () => {
    render(<InquiryForm />);
    fireEvent.click(screen.getByLabelText(/planning to bring a dog/i));
    expect(screen.getByLabelText(/how many dogs/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /view pet rules/i });
    expect(link).toHaveAttribute('href', '/house-rules#pets');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('client-side validates checkOut > checkIn before hitting the API', async () => {
    render(<InquiryForm />);
    fillForm({
      name: 'Jane',
      email: 'jane@example.com',
      checkIn: '2026-07-15',
      checkOut: '2026-07-15',
      numGuests: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: /send booking request/i }));
    await waitFor(() => {
      expect(screen.getByText(/check-out must be after check-in/i)).toBeInTheDocument();
    });
    expect(postCalls()).toHaveLength(0);
  });

  it('client-side validates email format', async () => {
    render(<InquiryForm />);
    fillForm({
      name: 'Jane',
      email: 'not-an-email',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: /send booking request/i }));
    await waitFor(() => {
      expect(screen.getByText(/valid email required/i)).toBeInTheDocument();
    });
    expect(postCalls()).toHaveLength(0);
  });

  it('caps the guest dropdown options at property.maxGuests', async () => {
    render(<InquiryForm />);
    // Wait for property fetch so maxGuests is known
    await waitFor(() => {
      expect(screen.getByText(/maximum 4 guests/i)).toBeInTheDocument();
    });
    const select = screen.getByLabelText(/number of guests/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['1', '2', '3', '4']);
  });

  it('submits with numGuests + petCount included', async () => {
    render(<InquiryForm />);
    fillForm({
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 3,
      message: 'Heading to Smith Rock',
    });
    fireEvent.click(screen.getByLabelText(/planning to bring a dog/i));
    // Default dog count is 1; bump to 2
    fireEvent.change(screen.getByLabelText(/how many dogs/i), { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: /send booking request/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    const posts = postCalls();
    expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0].body as string);
    expect(body).toMatchObject({
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 3,
      petCount: 2,
      message: 'Heading to Smith Rock',
    });
  });

  it('submits petCount: 0 when the pet checkbox is unchecked', async () => {
    render(<InquiryForm />);
    fillForm({
      name: 'Jane',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: /send booking request/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    const body = JSON.parse(postCalls()[0].body as string);
    expect(body.petCount).toBe(0);
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
    expect(screen.getByRole('link', { name: /change dates/i })).toHaveAttribute(
      'href',
      '/book',
    );
  });

  it('renders the price summary when dates are locked from the URL', async () => {
    setLocation('?checkIn=2026-07-15&checkOut=2026-07-18');
    render(<InquiryForm />);
    await waitFor(() => {
      expect(screen.getByText(/your stay/i)).toBeInTheDocument();
    });
    // Total from QUOTE_FIXTURE
    await waitFor(() => {
      expect(screen.getByText('$663.00')).toBeInTheDocument();
    });
    expect(screen.getByText(/3 nights/i)).toBeInTheDocument();
  });

  it('ignores URL params with malformed dates (falls back to editable inputs)', async () => {
    setLocation('?checkIn=not-a-date&checkOut=2026-07-18');
    render(<InquiryForm />);

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
    fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Invalid request body.' } }),
          { status: 400 },
        );
      }
      if (typeof input === 'string' && input.includes('/api/v1/property')) {
        return new Response(JSON.stringify(PROPERTY_FIXTURE), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<InquiryForm />);
    fillForm({
      name: 'Jane',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      numGuests: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: /send booking request/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid request body/i);
    });
  });
});
