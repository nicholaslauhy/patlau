'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { PostgrestError } from '@supabase/supabase-js';
import './styles.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log('Supabase Key:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ 
        email, 
        password 
      });
      
      if (error) {
        console.error('Full login error:', {
          message: error.message,
          name: error.name,
          stack: error.stack,
          cause: error.cause,
          status: error.status,
          raw: error
        });

        let errorMessage = 'Login failed: ' + error.message;
        if (error.message.includes('email not confirmed')) {
          errorMessage = 'Please confirm your email first (check your inbox)';
        } else if (error.message.includes('Invalid login credentials')) {
          errorMessage = 'Invalid email or password';
        } else if (error.message.includes('rate limit')) {
          errorMessage = 'Too many attempts - please try again later';
        } else if (error.message.includes('email')) {
          errorMessage = 'Invalid email format';
        } else if (error.message.includes('password')) {
          errorMessage = 'Password too weak (min 6 characters)';
        }
        throw new Error(errorMessage);
      }

      if (!data.user) {
        throw new Error('Login failed - no user data returned');
      }

      // Basic profile data to use if table operations fail
      let profileData = {
        id: data.user.id,
        name: data.user.email?.split('@')[0] || 'User'
      };

      try {
        // First verify the profiles table exists
        const { error: tableError } = await supabase
          .from('profiles')
          .select('*')
          .limit(1);
        
        if (tableError) {
          console.log('Profiles table not accessible, skipping profile operations');
        } else {
          // Table exists, proceed with profile operations
          const { data: existingProfile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .maybeSingle();

          if (!profileError && !existingProfile) {
            console.log('Creating new profile');
            const { error: createError } = await supabase
              .from('profiles')
              .insert({
                id: data.user.id,
                name: profileData.name,
                created_at: new Date().toISOString()
              });
            
            if (createError) {
              console.log('Profile creation skipped (non-critical)');
            }
          }
        }
      } catch (error) {
        console.log('Profile operations skipped due to error:', error);
      }

      // Store session
      await supabase.auth.setSession({
        access_token: data.session?.access_token || '',
        refresh_token: data.session?.refresh_token || ''
      });

      router.push('/dashboard');
    } catch (error) {
      console.error('Full login process error:', {
        error,
        timestamp: new Date().toISOString(),
        userAgent: navigator?.userAgent,
        url: window.location.href
      });
      const errorMessage = error instanceof Error ? 
        error.message : 
        'Login failed - see console for technical details';
      alert(errorMessage);
    }
  };

  return (
    <div className="container">
      <header>
                    <h1>RedSquare</h1>
        <div className="user-controls">
          <button className="share-btn" onClick={() => router.push('/signup')}>
            Sign Up
          </button>
        </div>
      </header>

      <main>
        <p className="welcome">Welcome back!</p>
        <div className="login-form">
          <form onSubmit={handleLogin}>
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
              Login
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
