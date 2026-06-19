import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { loginMbmBySms, type MbmUser, sendMbmSmsLoginCode } from "./mbm-auth-api"
import "./mbm-login-card.css"

export function MbmLoginCard(props: { onLogin: (user: MbmUser) => void | Promise<void>; loading?: boolean }) {
  const [phone, setPhone] = createSignal("")
  const [code, setCode] = createSignal("")
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [codeSent, setCodeSent] = createSignal(false)
  const [isNewUser, setIsNewUser] = createSignal(false)
  const [countdown, setCountdown] = createSignal(0)
  let timer: ReturnType<typeof setInterval> | undefined
  let codeInput: HTMLInputElement | undefined

  const normalizedPhone = createMemo(() => {
    const digits = phone().replace(/\D/g, "")
    return digits.startsWith("86") && digits.length > 11 ? digits.slice(2, 13) : digits.slice(0, 11)
  })
  const canSubmit = createMemo(
    () => !busy() && codeSent() && /^1\d{10}$/.test(normalizedPhone()) && /^\d{4}$/.test(code()),
  )

  const startCountdown = () => {
    setCountdown(60)
    timer = setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          if (timer) clearInterval(timer)
          return 0
        }
        return value - 1
      })
    }, 1000)
  }

  const handlePhoneInput = (value: string) => {
    const clean = value.replace(/\D/g, "")
    setPhone(clean.startsWith("86") && clean.length > 11 ? clean.slice(2, 13) : clean.slice(0, 11))
    setCode("")
    setCodeSent(false)
    setIsNewUser(false)
    setError("")
    setNotice("")
  }

  const sendCode = async () => {
    if (!/^1\d{10}$/.test(normalizedPhone())) {
      setError("请输入有效的手机号（仅支持 +86）")
      return
    }
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const nextIsNewUser = await sendMbmSmsLoginCode(normalizedPhone())
      setCodeSent(true)
      setIsNewUser(nextIsNewUser)
      startCountdown()
      setNotice(nextIsNewUser ? "验证码已发送，首次登录将自动注册" : "验证码已发送，请查收短信")
      requestAnimationFrame(() => codeInput?.focus())
    } catch (error) {
      setError(error instanceof Error ? error.message : "发送验证码失败，请重试")
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!codeSent()) {
      await sendCode()
      return
    }
    if (!canSubmit()) {
      setError("请输入 4 位验证码")
      return
    }
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await props.onLogin(await loginMbmBySms({ phone: normalizedPhone(), code: code() }))
    } catch (error) {
      setError(error instanceof Error ? error.message : "登录失败，请重试")
    } finally {
      setBusy(false)
    }
  }

  onCleanup(() => {
    if (timer) clearInterval(timer)
    document.body.classList.remove("mbm-auth-open")
  })

  return (
    <div class="mbm-login-overlay">
      <div role="dialog" aria-modal="true" aria-label="登录" class="mbm-login-panel">
        <div class="mbm-login-hero">
          <div class="mbm-login-hero-grid" />
          <div class="mbm-login-logo-row" aria-label="MBM CODE">
            <span class="mbm-login-logo-mark">M</span>
            <strong>MBM CODE</strong>
            <i />
          </div>
          <div class="mbm-login-typewriter">
            <h2>登录后，进入你的 AI 时刻</h2>
            <i />
          </div>
        </div>

        <form
          class="mbm-login-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy() && !props.loading) void submit()
          }}
        >
          <div class="mbm-login-phone-row">
            <input
              type="tel"
              inputMode="numeric"
              placeholder="请输入手机号（仅支持 +86）"
              value={normalizedPhone()}
              onInput={(event) => handlePhoneInput(event.currentTarget.value)}
              class="mbm-login-phone-input"
              disabled={props.loading}
            />
          </div>

          <Show when={codeSent()}>
            <div class="mbm-login-code-field">
              <input
                ref={codeInput}
                type="text"
                inputMode="numeric"
                placeholder="请输入 4 位验证码"
                value={code()}
                onInput={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 4))}
                class="mbm-login-code-input"
              />
              <button
                type="button"
                onClick={sendCode}
                disabled={busy() || countdown() > 0}
                class="mbm-login-resend-btn"
              >
                {countdown() > 0 ? `${countdown()}s` : "重新发送"}
              </button>
            </div>
          </Show>

          <Show when={error()}>
            <p class="mbm-login-tip mbm-login-tip-error">{error()}</p>
          </Show>
          <Show when={!error() && notice()}>
            <p class="mbm-login-tip mbm-login-tip-notice">{notice()}</p>
          </Show>

          <button
            type="submit"
            disabled={props.loading || busy() || (codeSent() ? !canSubmit() : normalizedPhone().length !== 11)}
            class="mbm-login-submit-btn"
          >
            {props.loading ? "正在检查登录状态..." : busy() ? "处理中..." : codeSent() ? "验证并登录" : "发送验证码"}
          </button>
        </form>
        <p class="mbm-login-bottom-subtitle">
          <span />
          首次登录将自动注册您的 MBM CODE 账号
        </p>
      </div>
    </div>
  )
}
