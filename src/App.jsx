import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

const tabs = [
  'Home',
  'Send money',
  'Receive money',
  'Request money',
  'Transaction history',
  'Currency converter',
  'My accounts',
  'Settings',
]

const formatVandola = (value) => {
  const num = Number(value || 0)
  return `V$${num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

const formatDate = (value) => {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const createAccountNumber = () => {
  const random = Math.floor(100000 + Math.random() * 900000)
  const branch = Math.floor(1000 + Math.random() * 9000)
  return `VDO-${random}-${branch}`
}

const getUserAccountByInput = async (input) => {
  const trimmed = String(input || '').trim()

  if (!trimmed) {
    throw new Error('Enter a username or account number.')
  }

  if (trimmed.includes('-')) {
    const { data: accountData, error } = await supabase
      .from('bank_accounts')
      .select('*, owner:owner_id(*)')
      .eq('account_number', trimmed)
      .maybeSingle()

    if (error) throw error
    if (!accountData) throw new Error('No account matches that Vandro account number.')
    return accountData
  }

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .ilike('username', trimmed)
    .maybeSingle()

  if (profileError) throw profileError
  if (!profileData) throw new Error('No user found with that username.')

  const { data: accountData, error: accountError } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('owner_id', profileData.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (accountError) throw accountError
  if (!accountData || !accountData.length) throw new Error('That user has no active Vandro account.')

  return { ...accountData[0], owner: profileData }
}

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [requests, setRequests] = useState([])
  const [activeTab, setActiveTab] = useState('Home')
  const [authMode, setAuthMode] = useState('signin')
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    username: '',
  })
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [newAccountName, setNewAccountName] = useState('Primary account')
  const [transferForm, setTransferForm] = useState({
    recipient: '',
    amount: '',
    description: 'Transfer',
    fromAccountId: '',
  })
  const [requestForm, setRequestForm] = useState({
    recipient: '',
    amount: '',
    description: 'Payment request',
  })
  const [settingsForm, setSettingsForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
  })
  const [converter, setConverter] = useState({ amount: '100', direction: 'usd-to-vandola' })

  const activeAccount = useMemo(() => {
    if (!accounts.length) return null
    const currentId = profile?.current_account_id
    return accounts.find((account) => account.id === currentId) || accounts[0]
  }, [accounts, profile])

  const loadAppData = async (userId) => {
    if (!userId) return

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (profileError) throw profileError

    if (!profileData) {
      setProfile(null)
      setAccounts([])
      setTransactions([])
      setRequests([])
      return
    }

    setProfile(profileData)
    setSettingsForm({
      firstName: profileData.first_name,
      lastName: profileData.last_name,
      username: profileData.username,
    })

    const { data: accountData, error: accountError } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })

    if (accountError) throw accountError
    setAccounts(accountData || [])

    const accountIds = (accountData || []).map((account) => account.id)

    if (accountIds.length) {
      const { data: txData, error: txError } = await supabase
        .from('transactions')
        .select('*')
        .or(`from_account_id.in.(${accountIds.join(',')}),to_account_id.in.(${accountIds.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(20)

      if (txError) throw txError
      setTransactions(txData || [])
    } else {
      setTransactions([])
    }

    const { data: requestData, error: requestError } = await supabase
      .from('payment_requests')
      .select('*')
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(20)

    if (requestError) throw requestError
    setRequests(requestData || [])
  }

  useEffect(() => {
    const getSession = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()

      setSession(currentSession)
      if (currentSession?.user?.id) {
        try {
          await loadAppData(currentSession.user.id)
        } catch (loadError) {
          setErrorMsg(loadError.message)
        }
      }
    }

    getSession()

    const subscription = supabase.auth.onAuthStateChange(async (_event, currentSession) => {
      setSession(currentSession)
      if (currentSession?.user?.id) {
        try {
          await loadAppData(currentSession.user.id)
        } catch (loadError) {
          setErrorMsg(loadError.message)
        }
      } else {
        setProfile(null)
        setAccounts([])
        setTransactions([])
        setRequests([])
      }
    })

    return () => subscription.data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!transferForm.fromAccountId && activeAccount) {
      setTransferForm((current) => ({ ...current, fromAccountId: activeAccount.id }))
    }
  }, [activeAccount, transferForm.fromAccountId])

  const resetFeedback = () => {
    setErrorMsg('')
    setSuccessMsg('')
  }

  const handleAuth = async (event) => {
    event.preventDefault()
    resetFeedback()

    try {
      if (authMode === 'signup') {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
          options: {
            data: {
              first_name: authForm.firstName,
              last_name: authForm.lastName,
              username: authForm.username,
            },
          },
        })

        if (signUpError) throw signUpError
        if (!signUpData.user) {
          throw new Error('Account created but the user record is not ready yet. Refresh and sign in.')
        }

        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', signUpData.user.id)
          .maybeSingle()

        if (!existingProfile) {
          const { error: profileError } = await supabase.from('profiles').insert({
            id: signUpData.user.id,
            username: authForm.username.trim(),
            first_name: authForm.firstName.trim(),
            last_name: authForm.lastName.trim(),
            email: authForm.email.trim(),
          })

          if (profileError) throw profileError
        }

        const { data: accountData, error: accountError } = await supabase
          .from('bank_accounts')
          .insert({
            owner_id: signUpData.user.id,
            account_name: `${authForm.firstName.trim()} ${authForm.lastName.trim()} Primary Account`,
            nickname: 'Primary account',
            account_number: createAccountNumber(),
            balance: 0,
            currency: 'V$',
          })
          .select()
          .single()

        if (accountError) throw accountError

        await supabase
          .from('profiles')
          .update({
            current_account_id: accountData.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', signUpData.user.id)

        setSuccessMsg('Account created successfully. Please sign in to continue.')
        setAuthMode('signin')
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        })
        if (error) throw error
        setSuccessMsg('Signed in successfully.')
      }

      setAuthForm({
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        username: '',
      })
    } catch (signInError) {
      setErrorMsg(signInError.message)
    }
  }

  const handlePasswordReset = async () => {
    resetFeedback()

    if (!authForm.email) {
      setErrorMsg('Enter an email address to reset your password.')
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(authForm.email)
    if (error) {
      setErrorMsg(error.message)
      return
    }

    setSuccessMsg('Password reset email sent.')
  }

  const handleSignOut = async () => {
    resetFeedback()
    const { error } = await supabase.auth.signOut()
    if (error) {
      setErrorMsg(error.message)
      return
    }

    setProfile(null)
    setAccounts([])
    setTransactions([])
    setRequests([])
  }

  const handleUpdateProfile = async (event) => {
    event.preventDefault()
    resetFeedback()

    if (!profile) {
      setErrorMsg('You must be signed in to update your profile.')
      return
    }

    try {
      const { error } = await supabase.from('profiles').update({
        first_name: settingsForm.firstName.trim(),
        last_name: settingsForm.lastName.trim(),
        username: settingsForm.username.trim(),
        updated_at: new Date().toISOString(),
      }).eq('id', profile.id)

      if (error) throw error
      setSuccessMsg('Profile updated.')
      await loadAppData(profile.id)
    } catch (updateError) {
      setErrorMsg(updateError.message)
    }
  }

  const handleCreateAccount = async (event) => {
    event.preventDefault()
    resetFeedback()

    if (!profile) {
      setErrorMsg('Sign in required.')
      return
    }

    try {
      const { data, error } = await supabase
        .from('bank_accounts')
        .insert({
          owner_id: profile.id,
          account_name: newAccountName.trim() || 'Savings account',
          nickname: newAccountName.trim() || 'Savings account',
          account_number: createAccountNumber(),
          balance: 0,
          currency: 'V$',
        })
        .select()
        .single()

      if (error) throw error

      await supabase.from('profiles').update({
        current_account_id: data.id,
        updated_at: new Date().toISOString(),
      }).eq('id', profile.id)

      setNewAccountName('')
      await loadAppData(profile.id)
      setSuccessMsg('New account created successfully.')
    } catch (createError) {
      setErrorMsg(createError.message)
    }
  }

  const handleSwitchAccount = async (accountId) => {
    if (!profile) return
    await supabase.from('profiles').update({
      current_account_id: accountId,
      updated_at: new Date().toISOString(),
    }).eq('id', profile.id)
    await loadAppData(profile.id)
  }

  const handleTransfer = async (event) => {
    event.preventDefault()
    resetFeedback()

    if (!profile || !activeAccount) {
      setErrorMsg('Sign in and select an account to transfer funds.')
      return
    }

    try {
      const sourceAccount = accounts.find((account) => account.id === transferForm.fromAccountId) || activeAccount
      const amount = Number(transferForm.amount)

      if (!sourceAccount) throw new Error('Source account not found.')
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Transfer amount must be greater than zero.')
      if (sourceAccount.balance < amount) throw new Error('Insufficient balance.')

      const recipientAccount = await getUserAccountByInput(transferForm.recipient)
      if (recipientAccount.id === sourceAccount.id) throw new Error('You cannot transfer to the same account.')

      const duplicateCheck = await supabase
        .from('transactions')
        .select('id')
        .eq('from_account_id', sourceAccount.id)
        .eq('to_account_id', recipientAccount.id)
        .eq('amount', amount)
        .eq('description', transferForm.description || 'Transfer')
        .gte('created_at', new Date(Date.now() - 60000).toISOString())

      if (duplicateCheck.error) throw duplicateCheck.error
      if (duplicateCheck.data && duplicateCheck.data.length) {
        throw new Error('A duplicate transfer was detected within the last minute.')
      }

      const { error: debitError } = await supabase
        .from('bank_accounts')
        .update({ balance: Number(sourceAccount.balance) - amount })
        .eq('id', sourceAccount.id)

      if (debitError) throw debitError

      const { error: creditError } = await supabase
        .from('bank_accounts')
        .update({ balance: Number(recipientAccount.balance || 0) + amount })
        .eq('id', recipientAccount.id)

      if (creditError) throw creditError

      const { error: txError } = await supabase.from('transactions').insert({
        from_account_id: sourceAccount.id,
        to_account_id: recipientAccount.id,
        amount,
        currency: 'V$',
        description: transferForm.description || 'Transfer',
        status: 'completed',
      })

      if (txError) throw txError

      setSuccessMsg('Transfer completed successfully.')
      setTransferForm({
        recipient: '',
        amount: '',
        description: 'Transfer',
        fromAccountId: sourceAccount.id,
      })
      await loadAppData(profile.id)
    } catch (transferError) {
      setErrorMsg(transferError.message)
    }
  }

  const handleRequestMoney = async (event) => {
    event.preventDefault()
    resetFeedback()

    if (!profile) {
      setErrorMsg('Sign in to request funds.')
      return
    }

    try {
      const recipientAccount = await getUserAccountByInput(requestForm.recipient)
      const amount = Number(requestForm.amount)
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Request amount must be greater than zero.')

      const { error } = await supabase.from('payment_requests').insert({
        requester_id: profile.id,
        recipient_id: recipientAccount.owner?.id || recipientAccount.owner_id,
        amount,
        description: requestForm.description || 'Payment request',
        status: 'pending',
      })

      if (error) throw error

      setSuccessMsg('Payment request created.')
      setRequestForm({ recipient: '', amount: '', description: 'Payment request' })
      await loadAppData(profile.id)
    } catch (requestError) {
      setErrorMsg(requestError.message)
    }
  }

  const handleApproveRequest = async (requestRecord) => {
    resetFeedback()

    if (!profile || !activeAccount) {
      setErrorMsg('Select an active account before approving a request.')
      return
    }

    try {
      const requesterProfile = await supabase
        .from('profiles')
        .select('*')
        .eq('id', requestRecord.requester_id)
        .maybeSingle()

      if (!requesterProfile.data) throw new Error('Requester not found.')

      const { data: requesterAccount, error: requesterAccountError } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('owner_id', requestRecord.requester_id)
        .order('created_at', { ascending: false })
        .limit(1)

      if (requesterAccountError) throw requesterAccountError
      if (!requesterAccount || !requesterAccount.length) throw new Error('Requester account not found.')

      const gateway = requesterAccount[0]
      const amount = Number(requestRecord.amount)
      if (Number(activeAccount.balance) < amount) throw new Error('Your available balance is too low to approve this request.')

      await supabase
        .from('bank_accounts')
        .update({ balance: Number(activeAccount.balance) - amount })
        .eq('id', activeAccount.id)

      await supabase
        .from('bank_accounts')
        .update({ balance: Number(gateway.balance || 0) + amount })
        .eq('id', gateway.id)

      await supabase.from('transactions').insert({
        from_account_id: activeAccount.id,
        to_account_id: gateway.id,
        amount,
        currency: 'V$',
        description: `Payment request: ${requestRecord.description}`,
        status: 'completed',
      })

      const { error: updateRequestError } = await supabase
        .from('payment_requests')
        .update({
          status: 'paid',
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestRecord.id)

      if (updateRequestError) throw updateRequestError

      setSuccessMsg('Request paid successfully.')
      await loadAppData(profile.id)
    } catch (approveError) {
      setErrorMsg(approveError.message)
    }
  }

  const converterValue = useMemo(() => {
    const amount = Number(converter.amount || 0)
    if (converter.direction === 'usd-to-vandola') {
      return (amount / 1.25).toFixed(2)
    }
    return (amount * 1.25).toFixed(2)
  }, [converter])

  if (!session) {
    return (
      <div className="page-shell auth-page">
        <div className="auth-card">
          <div className="brand-row">
            <div className="brand-mark">V</div>
            <div>
              <p className="eyebrow">United Provinces of Vandro</p>
              <h1>Vandro National Bank</h1>
            </div>
          </div>

          <div className="toggle-row">
            <button className={authMode === 'signin' ? 'toggle active' : 'toggle'} onClick={() => setAuthMode('signin')}>
              Sign in
            </button>
            <button className={authMode === 'signup' ? 'toggle active' : 'toggle'} onClick={() => setAuthMode('signup')}>
              Register
            </button>
          </div>

          <form className="auth-form" onSubmit={handleAuth}>
            {authMode === 'signup' && (
              <>
                <label>
                  First name
                  <input value={authForm.firstName} onChange={(event) => setAuthForm({ ...authForm, firstName: event.target.value })} required />
                </label>
                <label>
                  Last name
                  <input value={authForm.lastName} onChange={(event) => setAuthForm({ ...authForm, lastName: event.target.value })} required />
                </label>
                <label>
                  Username
                  <input value={authForm.username} onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })} required />
                </label>
              </>
            )}

            <label>
              Email
              <input type="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} required />
            </label>
            <label>
              Password
              <input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} required />
            </label>

            <button className="primary-btn" type="submit">
              {authMode === 'signup' ? 'Create account' : 'Sign in'}
            </button>

            {authMode === 'signin' && (
              <button type="button" className="secondary-btn" onClick={handlePasswordReset}>
                Reset password
              </button>
            )}
          </form>

          {errorMsg && <div className="alert error">{errorMsg}</div>}
          {successMsg && <div className="alert success">{successMsg}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell dashboard">
      <aside className="sidebar">
        <div className="brand-row sidebar-brand">
          <div className="brand-mark">V</div>
          <div>
            <p className="eyebrow">Official fictional banking</p>
            <h2>Vandro National Bank</h2>
          </div>
        </div>

        <nav className="nav-list">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? 'nav-button active' : 'nav-button'}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>

        <button className="secondary-btn signout" onClick={handleSignOut}>Sign out</button>
      </aside>

      <main className="content-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Welcome back</p>
            <h1>
              {profile ? `${profile.first_name} ${profile.last_name}` : 'Vandro Customer'}
            </h1>
          </div>
          <div className="balance-pill">
            <span>Primary balance</span>
            <strong>{activeAccount ? formatVandola(activeAccount.balance) : formatVandola(0)}</strong>
          </div>
        </header>

        {errorMsg && <div className="alert error">{errorMsg}</div>}
        {successMsg && <div className="alert success">{successMsg}</div>}

        {activeTab === 'Home' && (
          <section className="card-grid">
            <div className="overview-card accent">
              <p>Available balance</p>
              <h2>{activeAccount ? formatVandola(activeAccount.balance) : formatVandola(0)}</h2>
              <span>{activeAccount?.account_number || 'No account selected'}</span>
            </div>

            <div className="overview-card">
              <p>Recent transactions</p>
              <h2>{transactions.length}</h2>
              <span>Completed this month</span>
            </div>

            <div className="overview-card">
              <p>Accounts linked</p>
              <h2>{accounts.length}</h2>
              <span>Secure account portfolio</span>
            </div>

            <div className="quick-actions">
              <button className="primary-btn" onClick={() => setActiveTab('Send money')}>Send money</button>
              <button className="secondary-btn" onClick={() => setActiveTab('Request money')}>Request money</button>
              <button className="secondary-btn" onClick={() => setActiveTab('Currency converter')}>Convert currency</button>
            </div>

            <div className="full-width-card">
              <h3>Recent activity</h3>
              <div className="transaction-list">
                {transactions.length ? (
                  transactions.slice(0, 6).map((item) => (
                    <div key={item.id} className="transaction-item">
                      <div>
                        <strong>{item.description}</strong>
                        <small>{formatDate(item.created_at)}</small>
                      </div>
                      <span className={item.to_account_id === activeAccount?.id ? 'positive' : 'negative'}>
                        {item.to_account_id === activeAccount?.id ? '+' : '-'}{formatVandola(item.amount)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p>No transactions yet.</p>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'Send money' && (
          <section className="content-box">
            <h3>Send money</h3>
            <form className="stacked-form" onSubmit={handleTransfer}>
              <label>
                From account
                <select value={transferForm.fromAccountId} onChange={(event) => setTransferForm({ ...transferForm, fromAccountId: event.target.value })}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.account_name} — {formatVandola(account.balance)}</option>
                  ))}
                </select>
              </label>
              <label>
                Recipient username or account number
                <input value={transferForm.recipient} onChange={(event) => setTransferForm({ ...transferForm, recipient: event.target.value })} placeholder="e.g. janevandro or VDO-123456-1234" required />
              </label>
              <label>
                Amount
                <input type="number" min="0.01" step="0.01" value={transferForm.amount} onChange={(event) => setTransferForm({ ...transferForm, amount: event.target.value })} required />
              </label>
              <label>
                Description
                <input value={transferForm.description} onChange={(event) => setTransferForm({ ...transferForm, description: event.target.value })} required />
              </label>
              <button className="primary-btn" type="submit">Send V$</button>
            </form>
          </section>
        )}

        {activeTab === 'Receive money' && (
          <section className="content-box">
            <h3>Receive money</h3>
            {activeAccount ? (
              <div className="receive-card">
                <div className="detail-row">
                  <span>Account nickname</span>
                  <strong>{activeAccount.nickname || activeAccount.account_name}</strong>
                </div>
                <div className="detail-row">
                  <span>Account number</span>
                  <strong>{activeAccount.account_number}</strong>
                </div>
                <div className="detail-row">
                  <span>Currency</span>
                  <strong>{activeAccount.currency}</strong>
                </div>
                <div className="detail-row">
                  <span>Current balance</span>
                  <strong>{formatVandola(activeAccount.balance)}</strong>
                </div>
              </div>
            ) : (
              <p>No active account selected.</p>
            )}
          </section>
        )}

        {activeTab === 'Request money' && (
          <section className="content-box">
            <h3>Request money</h3>
            <form className="stacked-form" onSubmit={handleRequestMoney}>
              <label>
                Recipient username or account number
                <input value={requestForm.recipient} onChange={(event) => setRequestForm({ ...requestForm, recipient: event.target.value })} placeholder="username or account number" required />
              </label>
              <label>
                Amount
                <input type="number" min="0.01" step="0.01" value={requestForm.amount} onChange={(event) => setRequestForm({ ...requestForm, amount: event.target.value })} required />
              </label>
              <label>
                Description
                <input value={requestForm.description} onChange={(event) => setRequestForm({ ...requestForm, description: event.target.value })} required />
              </label>
              <button className="primary-btn" type="submit">Request payment</button>
            </form>

            {requests.length > 0 && (
              <div className="request-list">
                <h4>Open requests</h4>
                {requests.map((request) => (
                  <div key={request.id} className="request-item">
                    <div>
                      <strong>{request.description}</strong>
                      <small>{formatVandola(request.amount)}</small>
                    </div>
                    <div className="request-actions">
                      <span className="tag">{request.status}</span>
                      {request.recipient_id === profile.id && request.status !== 'paid' && (
                        <button className="secondary-btn" onClick={() => handleApproveRequest(request)}>Approve</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'Transaction history' && (
          <section className="content-box">
            <h3>Transaction history</h3>
            <div className="transaction-list large">
              {transactions.length ? (
                transactions.map((item) => (
                  <div key={item.id} className="transaction-item">
                    <div>
                      <strong>{item.description}</strong>
                      <small>{formatDate(item.created_at)}</small>
                    </div>
                    <div className="transaction-meta">
                      <span className={item.to_account_id === activeAccount?.id ? 'positive' : 'negative'}>
                        {item.to_account_id === activeAccount?.id ? '+' : '-'}{formatVandola(item.amount)}
                      </span>
                      <span className="tag">{item.status}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p>No transactions recorded yet.</p>
              )}
            </div>
          </section>
        )}

        {activeTab === 'Currency converter' && (
          <section className="content-box">
            <h3>Currency converter</h3>
            <div className="converter-box">
              <div className="converter-row">
                <label>
                  Amount
                  <input type="number" min="0" step="0.01" value={converter.amount} onChange={(event) => setConverter({ ...converter, amount: event.target.value })} />
                </label>
                <label>
                  Direction
                  <select value={converter.direction} onChange={(event) => setConverter({ ...converter, direction: event.target.value })}>
                    <option value="usd-to-vandola">US$ → V$</option>
                    <option value="vandola-to-usd">V$ → US$</option>
                  </select>
                </label>
              </div>

              <div className="conversion-result">
                <span>{converter.direction === 'usd-to-vandola' ? 'US$' : 'V$'}</span>
                <strong>{Number(converter.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                <span> = </span>
                <strong>
                  {converter.direction === 'usd-to-vandola' ? `V$${converterValue}` : `US$${converterValue}`}
                </strong>
              </div>
              <p className="subtext">Rate reference: US$1.25 = V$1.00</p>
            </div>
          </section>
        )}

        {activeTab === 'My accounts' && (
          <section className="content-box">
            <h3>My accounts</h3>
            <form className="inline-form" onSubmit={handleCreateAccount}>
              <input value={newAccountName} onChange={(event) => setNewAccountName(event.target.value)} placeholder="New account name" />
              <button className="primary-btn" type="submit">Create account</button>
            </form>

            <div className="account-list">
              {accounts.map((account) => (
                <div key={account.id} className={activeAccount?.id === account.id ? 'account-card active' : 'account-card'}>
                  <div>
                    <strong>{account.account_name}</strong>
                    <small>{account.account_number}</small>
                  </div>
                  <span>{formatVandola(account.balance)}</span>
                  {activeAccount?.id !== account.id && (
                    <button className="secondary-btn" onClick={() => handleSwitchAccount(account.id)}>Switch</button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'Settings' && (
          <section className="content-box">
            <h3>Account settings</h3>
            <form className="stacked-form" onSubmit={handleUpdateProfile}>
              <label>
                First name
                <input value={settingsForm.firstName} onChange={(event) => setSettingsForm({ ...settingsForm, firstName: event.target.value })} required />
              </label>
              <label>
                Last name
                <input value={settingsForm.lastName} onChange={(event) => setSettingsForm({ ...settingsForm, lastName: event.target.value })} required />
              </label>
              <label>
                Username
                <input value={settingsForm.username} onChange={(event) => setSettingsForm({ ...settingsForm, username: event.target.value })} required />
              </label>
              <button className="primary-btn" type="submit">Save profile</button>
            </form>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
