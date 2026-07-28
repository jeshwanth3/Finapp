'use client'

import React, { useState } from 'react'

export interface TransactionItem {
  id: string
  name: string
  type: string
  amount: number
  date: string
  time: string
  icon: React.ReactNode
  paymentMethod: string
  cardLastFour: string
  cardType?: 'visa' | 'mastercard'
}

export const defaultTransactions: TransactionItem[] = [
  {
    id: '1',
    name: 'Netflix',
    type: 'Subscription',
    amount: -15.99,
    date: 'July 1, 2024',
    time: '10:30 AM',
    icon: (
      <div style={{ padding: '8px' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 24C18.6274 24 24 18.6274 24 12C24 5.37258 18.6274 0 12 0C5.37258 0 0 5.37258 0 12C0 18.6274 5.37258 24 12 24ZM6 7C6 6.44772 6.44772 6 7 6H10C10.5523 6 11 6.44772 11 7V17C11 17.5523 10.5523 18 10 18H7C6.44772 18 6 17.5523 6 17V7ZM14 7C14 6.44772 14.4477 6 15 6H17C17.5523 6 18 6.44772 18 7V17C18 17.5523 17.5523 18 17 18H15C14.4477 18 14 17.5523 14 17V7Z"
            fill="currentColor"
          />
        </svg>
      </div>
    ),
    paymentMethod: 'Card',
    cardLastFour: '1234',
    cardType: 'visa',
  },
  {
    id: '2',
    name: 'Spotify',
    type: 'Subscription',
    amount: -9.99,
    date: 'July 2, 2024',
    time: '09:00 AM',
    icon: (
      <div style={{ padding: '8px' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 24C18.6274 24 24 18.6274 24 12C24 5.37258 18.6274 0 12 0C5.37258 0 0 5.37258 0 12C0 18.6274 5.37258 24 12 24ZM7 11C7 10.4477 7.44772 10 8 10H10C10.5523 10 11 10.4477 11 11V14C11 14.5523 10.5523 15 10 15H8C7.44772 15 7 14.5523 7 14V11ZM13 9C13 8.44772 13.4477 8 14 8H16C16.5523 8 17 8.44772 17 9V15C17 15.5523 16.5523 16 16 16H14C13.4477 16 13 15.5523 13 15V9ZM18 7C18 6.44772 18.4477 6 19 6H21C21.5523 6 22 6.44772 22 7V15C22 15.5523 21.5523 16 21 16H19C18.4477 16 18 15.5523 18 15V7Z"
            fill="currentColor"
          />
        </svg>
      </div>
    ),
    paymentMethod: 'Card',
    cardLastFour: '5678',
    cardType: 'mastercard',
  },
  {
    id: '3',
    name: 'Starbucks',
    type: 'Coffee',
    amount: -5.50,
    date: 'July 3, 2024',
    time: '08:15 AM',
    icon: (
      <div style={{ padding: '8px' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 24C18.6274 24 24 18.6274 24 12C24 5.37258 18.6274 0 12 0C5.37258 0 0 5.37258 0 12C0 18.6274 5.37258 24 12 24ZM12 8C9.79086 8 8 9.79086 8 12C8 14.2091 9.79086 16 12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8Z"
            fill="currentColor"
          />
        </svg>
      </div>
    ),
    paymentMethod: 'Card',
    cardLastFour: '9012',
    cardType: 'visa',
  },
]

export function TransactionList({ transactions = defaultTransactions }: { transactions?: TransactionItem[] }) {
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionItem | null>(null)

  return (
    <div style={{ maxWidth: '420px', margin: '0 auto', fontFamily: 'inherit', width: '100%' }}>
      <div
        style={{
          width: '100%',
          minHeight: selectedTransaction ? '350px' : '390px',
          overflow: 'hidden',
          borderRadius: '24px',
          background: 'rgba(15, 15, 20, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          color: '#ffffff',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0, 240, 255, 0.08)',
          transition: 'all 350ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {!selectedTransaction ? (
          <div style={{ padding: '20px', animation: 'fadeIn 200ms ease-in-out' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'rgba(255, 255, 255, 0.7)', marginBottom: '12px' }}>
              Recent Transactions
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  onClick={() => setSelectedTransaction(transaction)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderRadius: '12px',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    transition: 'background 150ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      style={{
                        borderRadius: '50%',
                        background: '#ffffff',
                        color: '#000000',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {transaction.icon}
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, color: '#ffffff', fontSize: '14px', margin: 0 }}>
                        {transaction.name}
                      </p>
                      <p style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.55)', margin: 0 }}>
                        {transaction.type}
                      </p>
                    </div>
                  </div>
                  <p style={{ fontWeight: 700, color: 'rgba(255, 255, 255, 0.85)', fontSize: '14px', margin: 0 }}>
                    ${Math.abs(transaction.amount).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
            <button
              style={{
                margin: '20px auto 4px',
                display: 'flex',
                width: '94%',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '10px 16px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 200ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)'
                e.currentTarget.style.transform = 'scale(1.03)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                e.currentTarget.style.transform = 'scale(1)'
              }}
            >
              All Transactions <ArrowRight />
            </button>
          </div>
        ) : (
          <div style={{ padding: '24px', animation: 'fadeIn 200ms ease-in-out' }}>
            <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    borderRadius: '12px',
                    background: '#ffffff',
                    color: '#000000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {selectedTransaction.icon}
                </div>
              </div>
              <button
                onClick={() => setSelectedTransaction(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#ffffff',
                }}
              >
                <XIcon />
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px dashed rgba(255, 255, 255, 0.2)',
                paddingBottom: '16px',
              }}
            >
              <div>
                <p style={{ fontWeight: 600, color: '#ffffff', fontSize: '16px', margin: 0 }}>
                  {selectedTransaction.name}
                </p>
                <p style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.55)', margin: 0 }}>
                  {selectedTransaction.type}
                </p>
              </div>
              <p style={{ fontWeight: 700, color: '#ffffff', fontSize: '18px', margin: 0 }}>
                ${Math.abs(selectedTransaction.amount).toFixed(2)}
              </p>
            </div>

            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'rgba(255, 255, 255, 0.55)' }}>
                <p style={{ margin: 0 }}>#{selectedTransaction.id}</p>
                <p style={{ margin: 0 }}>{selectedTransaction.date}</p>
                <p style={{ margin: 0 }}>{selectedTransaction.time}</p>
              </div>
              <div
                style={{
                  borderTop: '1px dashed rgba(255, 255, 255, 0.2)',
                  paddingTop: '16px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  fontSize: '13px',
                }}
              >
                <p style={{ fontWeight: 600, color: '#ffffff', margin: '0 0 8px 0' }}>
                  Paid Via {selectedTransaction.paymentMethod}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <CreditCardIcon />
                  <span style={{ color: '#ffffff', fontWeight: 500 }}>XXXX {selectedTransaction.cardLastFour}</span>
                  <div style={{ marginLeft: 'auto' }}>
                    {selectedTransaction.cardType === 'visa' ? <VisaLogo /> : <MasterCardLogo />}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ArrowRight() {
  return (
    <svg
      style={{ marginLeft: '8px' }}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

function CreditCardIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </svg>
  )
}

export function MasterCardLogo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="20" viewBox="0 0 256 199">
      <path
        fill="#ff5f00"
        d="M93.298 16.903h69.15v124.251h-69.15z"
      />
      <path
        fill="#eb001b"
        d="M97.689 79.029c0-25.245 11.854-47.637 30.074-62.126C114.373 6.366 97.47 0 79.03 0C35.343 0 0 35.343 0 79.029s35.343 79.029 79.029 79.029c18.44 0 35.343-6.366 48.734-16.904c-18.22-14.269-30.074-36.88-30.074-62.125"
      />
      <path
        fill="#f79e1b"
        d="M255.746 79.029c0 43.685-35.343 79.029-79.029 79.029c-18.44 0-35.343-6.366-48.734-16.904c18.44-14.488 30.075-36.88 30.075-62.125s-11.855-47.637-30.075-62.126C141.373 6.366 158.277 0 176.717 0c43.686 0 79.03 35.563 79.03 79.029"
      />
    </svg>
  )
}

export function VisaLogo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="16" viewBox="0 0 256 83">
      <path
        fill="#ffffff"
        d="M132.397 56.24c-.146-11.516 10.263-17.942 18.104-21.763c8.056-3.92 10.762-6.434 10.73-9.94c-.06-5.365-6.426-7.733-12.383-7.825c-10.393-.161-16.436 2.806-21.24 5.05l-3.744-17.519c4.82-2.221 13.745-4.158 23-4.243c21.725 0 35.938 10.724 36.015 27.351c.085 21.102-29.188 22.27-28.988 31.702c.069 2.86 2.798 5.912 8.778 6.688c2.96.392 11.131.692 20.395-3.574l3.636 16.95c-4.982 1.814-11.385 3.551-19.357 3.551c-20.448 0-34.83-10.87-34.946-26.428m89.241 24.968c-3.967 0-7.31-2.314-8.802-5.865L181.803 1.245h21.709l4.32 11.939h26.528l2.506-11.939H256l-16.697 79.963zm3.037-21.601l6.265-30.027h-17.158zm-118.599 21.6L88.964 1.246h20.687l17.104 79.963zm-30.603 0L53.941 26.782l-8.71 46.277c-1.022 5.166-5.058 8.149-9.54 8.149H.493L0 78.886c7.226-1.568 15.436-4.097 20.41-6.803c3.044-1.653 3.912-3.098 4.912-7.026L41.819 1.245H63.68l33.516 79.963z"
        transform="matrix(1 0 0 -1 0 82.668)"
      />
    </svg>
  )
}
