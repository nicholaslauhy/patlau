'use client';

'use client'
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { PostgrestError } from '@supabase/supabase-js';
import './../styles.css';

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // First sign up the user
      const signUpOptions = {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          name: name,
          email: email
        }
      };

      if (!process.env.NEXT_PUBLIC_SITE_URL) {
        throw new Error('Production URL not configured - set NEXT_PUBLIC_SITE_URL environment variable');
      }
      signUpOptions.emailRedirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`;

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: signUpOptions
      });

      if (authError) {
        console.error('Full signup error:', {
          message: authError.message,
          name: authError.name,
          stack: authError.stack,
          cause: authError.cause,
          status: authError.status,
          raw: authError
        });
        
        let errorMessage = 'Signup failed: ' + authError.message;
        if (authError.message.includes('email')) {
          errorMessage = 'Invalid email format';
        } else if (authError.message.includes('password')) {
          errorMessage = 'Password too weak (min 6 characters)';
        } else if (authError.message.includes('exists')) {
          errorMessage = 'Email already registered';
        } else if (authError.message.includes('rate limit')) {
          errorMessage = 'Too many attempts - please try again later';
        }
        throw new Error(errorMessage);
      }

      if (!authData.user) {
        console.log('Auth data:', authData);
        throw new Error('Please check your email to complete signup');
      }

      // Always require email confirmation
      if (!authData.user?.email_confirmed_at) {
        alert('Please check your email for a confirmation link before logging in');
        router.push('/');
        return;
      }

      // Create profile via API endpoint (only after email confirmation)
      const profileResponse = await fetch('/api/create-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: authData.user?.id,
          name: name
        })
      });

      if (!profileResponse.ok) {
        const errorData = await profileResponse.json();
        console.error('Profile creation error:', errorData.error);
        
        // Attempt to delete the user if profile creation failed
        try {
          await supabase.auth.admin.deleteUser(authData.user?.id || '');
        } catch (deleteError) {
          console.error('Failed to delete user after profile creation failure:', deleteError);
        }

        throw new Error('Failed to create profile - please contact support');
      }

      router.push('/dashboard');
    } catch (error) {
      console.error('Full signup process error:', {
        error,
        timestamp: new Date().toISOString(),
        userAgent: navigator?.userAgent,
        url: window.location.href
      });
      const errorMessage = error instanceof Error ? 
        error.message : 
        'Signup failed - see console for technical details';
      alert(errorMessage);
      console.error('Full error object:', error);
    }
  };

  return (
    <div className="container">
      <header>
        <h1>RedSquare</h1>
        <div className="user-controls">
          <button className="share-btn" onClick={() => router.push('/')}>
            Login
          </button>
        </div>
      </header>

      <main>
        <p className="welcome">Create your account</p>
        <div className="login-form">
          <form onSubmit={handleSignUp}>
            <div className="form-group">
              <label htmlFor="name">Name</label>
              <input
                type="text"
                id="name"
                className="form-input"
                placeholder="Enter your name"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                className="form-input"
                placeholder="Enter your email"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                className="form-input"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="share-btn login-btn">
              Sign Up
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
