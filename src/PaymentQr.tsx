export default function PaymentQr({ reference }: { reference?: string }) {
  return <div className="payment-qr">
    <img src="/ahuza-upi-qr.png" width="224" height="224" alt="AHUZA UPI payment QR code" />
    <p>Scan with your UPI app, enter the exact amount shown above, and use order reference {reference || 'shown above'} as the payment note.</p>
  </div>;
}
