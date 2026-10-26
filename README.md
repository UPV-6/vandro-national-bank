# Vandro National Bank

A fictional online banking app for the United Provinces of Vandro, with Vandola accounting, secure authentication, account switching, payment requests, and fake banking operations.

This project is intended as a demo and does not represent a real licensed bank.

## Stack

- React + Vite
- Supabase for authentication and database
- Row Level Security (RLS) for privacy and access control

## Local setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env` and fill in your project URL and anon key.
3. Run the SQL in `supabase/schema.sql` in the Supabase SQL editor.
4. Install dependencies:

   npm install

5. Start the app:

   npm run dev

## Currency model

- Main currency: Vandola (V$)
- Coin unit: Van
- 100 Vans = 1 Vandola
- Conversion reference: US$1.25 = V$1.00

## Security notes

- This is fictional only. It does not connect to real bank accounts and does not claim to be a licensed financial institution.
- Authentication is handled through Supabase Auth.
- Database access is restricted using row-level security policies.

## Core features

- Sign-up, sign-in, password reset
- Multiple accounts per user
- Unique account numbers
- Active account switching
- Dashboard with balances and recent activity
- Send money, receive money, request money
- Transaction history and currency converter
- Settings and sign-out
- Negative-balance prevention and duplicate-transfer protection

## SQL schema

The database setup is defined in `supabase/schema.sql`.
