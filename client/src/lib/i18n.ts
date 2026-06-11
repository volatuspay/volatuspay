import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// TRADUÇÕES COMPLETAS PARA CHECKOUT GLOBAL
const translations = {
  en: {
    translation: {
      checkout: {
        title: "Complete Your Purchase",
        personalData: "Your Information",
        paymentMethod: "Payment Method",
        orderSummary: "Order Summary",
        yourData: "Your Details",
        whyWeAsk: "Why do we ask for this?",
        whyWeAskTooltip: "We need this information to process your order and send you updates about your purchase.",
        onlineVisitors: "people viewing now",
        securePayment: "Secure Payment",
        fields: {
          name: "Full Name",
          email: "Email Address",
          confirmEmail: "Confirm Email",
          document: "ID/Passport",
          phone: "Phone Number",
          address: "Address",
          street: "Street",
          number: "Number",
          complement: "Apt/Suite",
          neighborhood: "Neighborhood",
          city: "City",
          state: "State",
          zipCode: "ZIP/Postal Code",
          country: "Country"
        },
        placeholders: {
          email: "your@email.com",
          confirmEmail: "confirm@email.com",
          name: "Your full name",
          document: "ID/Passport number",
          phone: "Your phone number",
          street: "Street name",
          number: "Number",
          complement: "Apartment, suite, etc.",
          neighborhood: "Neighborhood",
          city: "City",
          state: "State",
          zipCode: "ZIP Code",
          country: "Country"
        },
        steps: {
          delivery: "Delivery",
          payment: "Payment"
        },
        payment: {
          card: "Credit/Debit Card",
          pix: "PIX",
          boleto: "Bank Slip",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "Processing payment...",
          success: "Payment successful!",
          error: "Payment failed. Please try again.",
          secure: "Your data is protected with SSL encryption",
          total: "Total",
          subtotal: "Subtotal",
          discount: "Discount",
          shipping: "Shipping",
          free: "Free"
        },
        buttons: {
          continue: "Continue",
          back: "Back",
          pay: "Pay Now",
          payAmount: "Pay {{amount}}",
          finalize: "Finalize Purchase",
          processing: "Processing..."
        },
        validation: {
          required: "This field is required",
          requiredName: "Name is required",
          invalidEmail: "Invalid email",
          emailsDontMatch: "Emails don't match",
          requiredDocument: "ID/Passport is required",
          requiredPhone: "Phone is required",
          requiredStreet: "Street is required",
          requiredNumber: "Number is required",
          requiredNeighborhood: "Neighborhood is required",
          requiredCity: "City is required",
          requiredState: "State is required",
          requiredStateShort: "Use state abbreviation (e.g., CA)",
          requiredZipCode: "ZIP code is required",
          email: "Please enter a valid email address",
          phone: "Please enter a valid phone number",
          fillPersonalData: "Please fill in all personal information.",
          fillDeliveryData: "Please fill in all delivery information.",
          invalidCoupon: "Invalid coupon"
        },
        labels: {
          investmentAmount: "Investment Amount",
          address: "Address",
          paymentConfirmation: "Payment Confirmation",
          thankYou: "Thank you for your purchase. You will receive an email confirmation shortly.",
          deliveryAddress: "Delivery Address",
          discount: "Discount",
          couponCode: "Coupon Code",
          subtotal: "Subtotal",
          totalAmount: "Total",
          selectPayment: "Select payment method"
        },
        coupon: {
          applied: "Coupon applied!",
          removed: "Coupon removed",
          invalid: "Invalid coupon",
          enterCode: "Enter code",
          apply: "Apply",
          validating: "Validating...",
          haveCode: "Have a coupon code?"
        },
        guarantee: {
          title: "Money Back Guarantee",
          description: "{{days}}-day money back guarantee"
        }
      }
    }
  },
  es: {
    translation: {
      checkout: {
        title: "Completa tu Compra",
        personalData: "Tu Información",
        paymentMethod: "Método de Pago",
        orderSummary: "Resumen del Pedido",
        yourData: "Tus Datos",
        whyWeAsk: "¿Por qué pedimos esto?",
        whyWeAskTooltip: "Necesitamos esta información para procesar tu pedido y enviarte actualizaciones sobre tu compra.",
        onlineVisitors: "personas viendo ahora",
        securePayment: "Pago Seguro",
        fields: {
          name: "Nombre Completo",
          email: "Correo Electrónico",
          confirmEmail: "Confirmar Email",
          document: "Documento/ID",
          phone: "Número de Teléfono",
          address: "Dirección",
          street: "Calle",
          number: "Número",
          complement: "Apto/Suite",
          neighborhood: "Barrio",
          city: "Ciudad",
          state: "Estado/Provincia",
          zipCode: "Código Postal",
          country: "País"
        },
        placeholders: {
          email: "tu@email.com",
          confirmEmail: "confirmar@email.com",
          name: "Tu nombre completo",
          document: "Documento/ID",
          phone: "Tu número de teléfono",
          street: "Nombre de calle",
          number: "Número",
          complement: "Apartamento, piso, etc.",
          neighborhood: "Barrio",
          city: "Ciudad",
          state: "Estado",
          zipCode: "Código Postal",
          country: "País"
        },
        steps: {
          delivery: "Entrega",
          payment: "Pago"
        },
        payment: {
          card: "Tarjeta de Crédito/Débito",
          pix: "PIX",
          boleto: "Boleto Bancario",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "Procesando pago...",
          success: "¡Pago exitoso!",
          error: "Pago fallido. Por favor intenta de nuevo.",
          secure: "Tus datos están protegidos con encriptación SSL",
          total: "Total",
          subtotal: "Subtotal",
          discount: "Descuento",
          shipping: "Envío",
          free: "Gratis"
        },
        buttons: {
          continue: "Continuar",
          back: "Volver",
          pay: "Pagar Ahora",
          payAmount: "Pagar {{amount}}",
          finalize: "Finalizar Compra",
          processing: "Procesando..."
        },
        validation: {
          required: "Este campo es requerido",
          requiredName: "Nombre es requerido",
          invalidEmail: "Email inválido",
          emailsDontMatch: "Los emails no coinciden",
          requiredDocument: "Documento/ID es requerido",
          requiredPhone: "Teléfono es requerido",
          requiredStreet: "Calle es requerida",
          requiredNumber: "Número es requerido",
          requiredNeighborhood: "Barrio es requerido",
          requiredCity: "Ciudad es requerida",
          requiredState: "Estado es requerido",
          requiredStateShort: "Usa abreviatura del estado",
          requiredZipCode: "Código postal es requerido",
          email: "Por favor ingresa un email válido",
          phone: "Por favor ingresa un número válido",
          fillPersonalData: "Por favor completa toda la información personal.",
          fillDeliveryData: "Por favor completa toda la información de entrega.",
          invalidCoupon: "Cupón inválido"
        },
        labels: {
          investmentAmount: "Monto de Inversión",
          address: "Dirección",
          paymentConfirmation: "Confirmación de Pago",
          thankYou: "Gracias por tu compra. Recibirás un email de confirmación pronto.",
          deliveryAddress: "Dirección de entrega",
          discount: "Descuento",
          couponCode: "Código de Cupón",
          subtotal: "Subtotal",
          totalAmount: "Total",
          selectPayment: "Selecciona método de pago"
        },
        coupon: {
          applied: "¡Cupón aplicado!",
          removed: "Cupón removido",
          invalid: "Cupón inválido",
          enterCode: "Ingresar código",
          apply: "Aplicar",
          validating: "Validando...",
          haveCode: "¿Tienes un código de cupón?"
        },
        guarantee: {
          title: "Garantía de Devolución",
          description: "Garantía de {{days}} días"
        }
      }
    }
  },
  pt: {
    translation: {
      checkout: {
        title: "Complete sua Compra",
        personalData: "Suas Informações",
        paymentMethod: "Método de Pagamento",
        orderSummary: "Resumo do Pedido",
        yourData: "Seus Dados",
        whyWeAsk: "Por que pedimos isso?",
        whyWeAskTooltip: "Precisamos dessas informações para processar seu pedido e enviar atualizações sobre sua compra.",
        onlineVisitors: "pessoas vendo agora",
        securePayment: "Pagamento Seguro",
        fields: {
          name: "Nome Completo",
          email: "E-mail",
          confirmEmail: "Confirmar E-mail",
          document: "CPF/CNPJ",
          phone: "Celular",
          address: "Endereço",
          street: "Rua",
          number: "Número",
          complement: "Complemento",
          neighborhood: "Bairro",
          city: "Cidade",
          state: "Estado",
          zipCode: "CEP",
          country: "País"
        },
        placeholders: {
          email: "seu@email.com",
          confirmEmail: "confirmar@email.com",
          name: "Seu nome completo",
          document: "000.000.000-00",
          phone: "(00) 00000-0000",
          street: "Nome da rua",
          number: "123",
          complement: "Apto, bloco, etc.",
          neighborhood: "Nome do bairro",
          city: "Nome da cidade",
          state: "SP",
          zipCode: "00000-000",
          country: "Brasil"
        },
        steps: {
          delivery: "Entrega",
          payment: "Pagamento"
        },
        payment: {
          card: "Cartão de Crédito/Débito",
          pix: "PIX",
          boleto: "Boleto Bancário",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "Processando pagamento...",
          success: "Pagamento realizado com sucesso!",
          error: "Falha no pagamento. Tente novamente.",
          secure: "Seus dados estão protegidos com criptografia SSL",
          total: "Total",
          subtotal: "Subtotal",
          discount: "Desconto",
          shipping: "Frete",
          free: "Grátis"
        },
        buttons: {
          continue: "Continuar",
          back: "Voltar",
          pay: "Pagar Agora",
          payAmount: "Pagar {{amount}}",
          finalize: "Finalizar Compra",
          processing: "Processando..."
        },
        validation: {
          required: "Este campo é obrigatório",
          requiredName: "Nome é obrigatório",
          invalidEmail: "Email inválido",
          emailsDontMatch: "Os emails não coincidem",
          requiredDocument: "CPF/CNPJ é obrigatório",
          requiredPhone: "Telefone é obrigatório",
          requiredStreet: "Rua é obrigatória",
          requiredNumber: "Número é obrigatório",
          requiredNeighborhood: "Bairro é obrigatório",
          requiredCity: "Cidade é obrigatória",
          requiredState: "Estado é obrigatório",
          requiredStateShort: "Use a sigla do estado (ex: SP)",
          requiredZipCode: "CEP é obrigatório",
          email: "Por favor insira um email válido",
          phone: "Por favor insira um telefone válido",
          fillPersonalData: "Por favor, preencha todos os dados pessoais.",
          fillDeliveryData: "Por favor, preencha todos os dados de entrega.",
          invalidCoupon: "Cupom inválido"
        },
        labels: {
          investmentAmount: "Valor do Investimento",
          address: "Endereço",
          paymentConfirmation: "Confirmação de Pagamento",
          thankYou: "Obrigado por sua compra. Você receberá um email de confirmação em breve.",
          deliveryAddress: "Endereço de entrega",
          discount: "Desconto",
          couponCode: "Cupom de Desconto",
          subtotal: "Subtotal",
          totalAmount: "Total",
          selectPayment: "Selecione o método de pagamento"
        },
        coupon: {
          applied: "Cupom aplicado!",
          removed: "Cupom removido",
          invalid: "Cupom inválido",
          enterCode: "Digite o código",
          apply: "Aplicar",
          validating: "Validando...",
          haveCode: "Tem um cupom de desconto?"
        },
        guarantee: {
          title: "Garantia de Reembolso",
          description: "Garantia de {{days}} dias"
        }
      }
    }
  },
  'pt-BR': {
    translation: {
      checkout: {
        title: "Complete sua Compra",
        personalData: "Suas Informações",
        paymentMethod: "Método de Pagamento",
        orderSummary: "Resumo do Pedido",
        yourData: "Seus Dados",
        whyWeAsk: "Por que pedimos isso?",
        whyWeAskTooltip: "Precisamos dessas informações para processar seu pedido e enviar atualizações sobre sua compra.",
        onlineVisitors: "pessoas vendo agora",
        securePayment: "Pagamento Seguro",
        fields: {
          name: "Nome Completo",
          email: "E-mail",
          confirmEmail: "Confirmar E-mail",
          document: "CPF/CNPJ",
          phone: "Celular",
          address: "Endereço",
          street: "Rua",
          number: "Número",
          complement: "Complemento",
          neighborhood: "Bairro",
          city: "Cidade",
          state: "Estado",
          zipCode: "CEP",
          country: "País"
        },
        placeholders: {
          email: "seu@email.com",
          confirmEmail: "confirmar@email.com",
          name: "Seu nome completo",
          document: "000.000.000-00",
          phone: "(00) 00000-0000",
          street: "Nome da rua",
          number: "123",
          complement: "Apto, bloco, etc.",
          neighborhood: "Nome do bairro",
          city: "Nome da cidade",
          state: "SP",
          zipCode: "00000-000",
          country: "Brasil"
        },
        steps: {
          delivery: "Entrega",
          payment: "Pagamento"
        },
        payment: {
          card: "Cartão de Crédito/Débito",
          pix: "PIX",
          boleto: "Boleto Bancário",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "Processando pagamento...",
          success: "Pagamento realizado com sucesso!",
          error: "Falha no pagamento. Tente novamente.",
          secure: "Seus dados estão protegidos com criptografia SSL",
          total: "Total",
          subtotal: "Subtotal",
          discount: "Desconto",
          shipping: "Frete",
          free: "Grátis"
        },
        buttons: {
          continue: "Continuar",
          back: "Voltar",
          pay: "Pagar Agora",
          payAmount: "Pagar {{amount}}",
          finalize: "Finalizar Compra",
          processing: "Processando..."
        },
        validation: {
          required: "Este campo é obrigatório",
          requiredName: "Nome é obrigatório",
          invalidEmail: "Email inválido",
          emailsDontMatch: "Os emails não coincidem",
          requiredDocument: "CPF/CNPJ é obrigatório",
          requiredPhone: "Telefone é obrigatório",
          requiredStreet: "Rua é obrigatória",
          requiredNumber: "Número é obrigatório",
          requiredNeighborhood: "Bairro é obrigatório",
          requiredCity: "Cidade é obrigatória",
          requiredState: "Estado é obrigatório",
          requiredStateShort: "Use a sigla do estado (ex: SP)",
          requiredZipCode: "CEP é obrigatório",
          email: "Por favor insira um email válido",
          phone: "Por favor insira um telefone válido",
          fillPersonalData: "Por favor, preencha todos os dados pessoais.",
          fillDeliveryData: "Por favor, preencha todos os dados de entrega.",
          invalidCoupon: "Cupom inválido"
        },
        labels: {
          investmentAmount: "Valor do Investimento",
          address: "Endereço",
          paymentConfirmation: "Confirmação de Pagamento",
          thankYou: "Obrigado por sua compra. Você receberá um email de confirmação em breve.",
          deliveryAddress: "Endereço de entrega",
          discount: "Desconto",
          couponCode: "Cupom de Desconto",
          subtotal: "Subtotal",
          totalAmount: "Total",
          selectPayment: "Selecione o método de pagamento"
        },
        coupon: {
          applied: "Cupom aplicado!",
          removed: "Cupom removido",
          invalid: "Cupom inválido",
          enterCode: "Digite o código",
          apply: "Aplicar",
          validating: "Validando...",
          haveCode: "Tem um cupom de desconto?"
        },
        guarantee: {
          title: "Garantia de Reembolso",
          description: "Garantia de {{days}} dias"
        }
      }
    }
  },
  fr: {
    translation: {
      checkout: {
        title: "Finalisez votre Achat",
        personalData: "Vos Informations",
        paymentMethod: "Mode de Paiement",
        orderSummary: "Résumé de la Commande",
        yourData: "Vos Données",
        whyWeAsk: "Pourquoi demandons-nous cela?",
        whyWeAskTooltip: "Nous avons besoin de ces informations pour traiter votre commande et vous envoyer des mises à jour.",
        onlineVisitors: "personnes consultent maintenant",
        securePayment: "Paiement Sécurisé",
        fields: {
          name: "Nom Complet",
          email: "Adresse E-mail",
          confirmEmail: "Confirmer l'E-mail",
          document: "Pièce d'Identité",
          phone: "Numéro de Téléphone",
          address: "Adresse",
          street: "Rue",
          number: "Numéro",
          complement: "Complément",
          neighborhood: "Quartier",
          city: "Ville",
          state: "Région",
          zipCode: "Code Postal",
          country: "Pays"
        },
        placeholders: {
          email: "votre@email.com",
          confirmEmail: "confirmer@email.com",
          name: "Votre nom complet",
          document: "Numéro d'identité",
          phone: "Votre numéro de téléphone",
          street: "Nom de la rue",
          number: "Numéro",
          complement: "Appartement, étage, etc.",
          neighborhood: "Quartier",
          city: "Ville",
          state: "Région",
          zipCode: "Code Postal",
          country: "Pays"
        },
        steps: {
          delivery: "Livraison",
          payment: "Paiement"
        },
        payment: {
          card: "Carte de Crédit/Débit",
          pix: "PIX",
          boleto: "Virement Bancaire",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "Traitement du paiement...",
          success: "Paiement réussi!",
          error: "Échec du paiement. Veuillez réessayer.",
          secure: "Vos données sont protégées par cryptage SSL",
          total: "Total",
          subtotal: "Sous-total",
          discount: "Réduction",
          shipping: "Livraison",
          free: "Gratuit"
        },
        buttons: {
          continue: "Continuer",
          back: "Retour",
          pay: "Payer Maintenant",
          payAmount: "Payer {{amount}}",
          finalize: "Finaliser l'Achat",
          processing: "Traitement..."
        },
        validation: {
          required: "Ce champ est obligatoire",
          requiredName: "Le nom est requis",
          invalidEmail: "Email invalide",
          emailsDontMatch: "Les emails ne correspondent pas",
          requiredDocument: "Pièce d'identité requise",
          requiredPhone: "Téléphone requis",
          requiredStreet: "Rue requise",
          requiredNumber: "Numéro requis",
          requiredNeighborhood: "Quartier requis",
          requiredCity: "Ville requise",
          requiredState: "Région requise",
          requiredStateShort: "Utilisez l'abréviation",
          requiredZipCode: "Code postal requis",
          email: "Veuillez entrer un email valide",
          phone: "Veuillez entrer un numéro valide",
          fillPersonalData: "Veuillez remplir toutes les informations personnelles.",
          fillDeliveryData: "Veuillez remplir toutes les informations de livraison.",
          invalidCoupon: "Coupon invalide"
        },
        labels: {
          investmentAmount: "Montant d'Investissement",
          address: "Adresse",
          paymentConfirmation: "Confirmation de Paiement",
          thankYou: "Merci pour votre achat. Vous recevrez un email de confirmation bientôt.",
          deliveryAddress: "Adresse de livraison",
          discount: "Réduction",
          couponCode: "Code Promo",
          subtotal: "Sous-total",
          totalAmount: "Total",
          selectPayment: "Sélectionnez le mode de paiement"
        },
        coupon: {
          applied: "Coupon appliqué!",
          removed: "Coupon supprimé",
          invalid: "Coupon invalide",
          enterCode: "Entrez le code",
          apply: "Appliquer",
          validating: "Validation...",
          haveCode: "Avez-vous un code promo?"
        },
        guarantee: {
          title: "Garantie de Remboursement",
          description: "Garantie de {{days}} jours"
        }
      }
    }
  },
  de: {
    translation: {
      checkout: {
        title: "Kauf abschließen",
        personalData: "Ihre Informationen",
        paymentMethod: "Zahlungsmethode",
        orderSummary: "Bestellübersicht",
        yourData: "Ihre Daten",
        whyWeAsk: "Warum fragen wir danach?",
        whyWeAskTooltip: "Wir benötigen diese Informationen, um Ihre Bestellung zu bearbeiten und Ihnen Updates zu senden.",
        onlineVisitors: "Personen sehen gerade",
        securePayment: "Sichere Zahlung",
        fields: {
          name: "Vollständiger Name",
          email: "E-Mail-Adresse",
          confirmEmail: "E-Mail bestätigen",
          document: "Ausweis/Pass",
          phone: "Telefonnummer",
          address: "Adresse",
          street: "Straße",
          number: "Hausnummer",
          complement: "Zusatz",
          neighborhood: "Stadtteil",
          city: "Stadt",
          state: "Bundesland",
          zipCode: "Postleitzahl",
          country: "Land"
        },
        placeholders: {
          email: "ihre@email.de",
          confirmEmail: "bestaetigen@email.de",
          name: "Ihr vollständiger Name",
          document: "Ausweisnummer",
          phone: "Ihre Telefonnummer",
          street: "Straßenname",
          number: "Nr.",
          complement: "Wohnung, Etage, etc.",
          neighborhood: "Stadtteil",
          city: "Stadt",
          state: "Bundesland",
          zipCode: "PLZ",
          country: "Land"
        },
        steps: {
          delivery: "Lieferung",
          payment: "Zahlung"
        },
        payment: {
          card: "Kredit-/Debitkarte",
          pix: "PIX",
          boleto: "Banküberweisung",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "Zahlung wird verarbeitet...",
          success: "Zahlung erfolgreich!",
          error: "Zahlung fehlgeschlagen. Bitte erneut versuchen.",
          secure: "Ihre Daten sind SSL-verschlüsselt",
          total: "Gesamt",
          subtotal: "Zwischensumme",
          discount: "Rabatt",
          shipping: "Versand",
          free: "Kostenlos"
        },
        buttons: {
          continue: "Weiter",
          back: "Zurück",
          pay: "Jetzt Bezahlen",
          payAmount: "{{amount}} bezahlen",
          finalize: "Kauf abschließen",
          processing: "Verarbeitung..."
        },
        validation: {
          required: "Dieses Feld ist erforderlich",
          requiredName: "Name ist erforderlich",
          invalidEmail: "Ungültige E-Mail",
          emailsDontMatch: "E-Mails stimmen nicht überein",
          requiredDocument: "Ausweis ist erforderlich",
          requiredPhone: "Telefon ist erforderlich",
          requiredStreet: "Straße ist erforderlich",
          requiredNumber: "Hausnummer ist erforderlich",
          requiredNeighborhood: "Stadtteil ist erforderlich",
          requiredCity: "Stadt ist erforderlich",
          requiredState: "Bundesland ist erforderlich",
          requiredStateShort: "Verwenden Sie die Abkürzung",
          requiredZipCode: "PLZ ist erforderlich",
          email: "Bitte geben Sie eine gültige E-Mail ein",
          phone: "Bitte geben Sie eine gültige Nummer ein",
          fillPersonalData: "Bitte füllen Sie alle persönlichen Daten aus.",
          fillDeliveryData: "Bitte füllen Sie alle Lieferdaten aus.",
          invalidCoupon: "Ungültiger Gutschein"
        },
        labels: {
          investmentAmount: "Investitionsbetrag",
          address: "Adresse",
          paymentConfirmation: "Zahlungsbestätigung",
          thankYou: "Vielen Dank für Ihren Kauf. Sie erhalten in Kürze eine Bestätigungs-E-Mail.",
          deliveryAddress: "Lieferadresse",
          discount: "Rabatt",
          couponCode: "Gutscheincode",
          subtotal: "Zwischensumme",
          totalAmount: "Gesamt",
          selectPayment: "Zahlungsmethode auswählen"
        },
        coupon: {
          applied: "Gutschein angewendet!",
          removed: "Gutschein entfernt",
          invalid: "Ungültiger Gutschein",
          enterCode: "Code eingeben",
          apply: "Anwenden",
          validating: "Überprüfung...",
          haveCode: "Haben Sie einen Gutscheincode?"
        },
        guarantee: {
          title: "Geld-zurück-Garantie",
          description: "{{days}}-Tage-Garantie"
        }
      }
    }
  },
  it: {
    translation: {
      checkout: {
        title: "Completa il tuo Acquisto",
        personalData: "Le tue Informazioni",
        paymentMethod: "Metodo di Pagamento",
        orderSummary: "Riepilogo Ordine",
        yourData: "I tuoi Dati",
        whyWeAsk: "Perché chiediamo questo?",
        whyWeAskTooltip: "Abbiamo bisogno di queste informazioni per elaborare il tuo ordine e inviarti aggiornamenti.",
        onlineVisitors: "persone stanno guardando",
        securePayment: "Pagamento Sicuro",
        fields: {
          name: "Nome Completo",
          email: "Indirizzo E-mail",
          confirmEmail: "Conferma E-mail",
          document: "Documento/ID",
          phone: "Numero di Telefono",
          address: "Indirizzo",
          street: "Via",
          number: "Numero",
          complement: "Interno",
          neighborhood: "Quartiere",
          city: "Città",
          state: "Regione",
          zipCode: "CAP",
          country: "Paese"
        },
        placeholders: {
          email: "tua@email.it",
          confirmEmail: "conferma@email.it",
          name: "Il tuo nome completo",
          document: "Numero documento",
          phone: "Il tuo numero di telefono",
          street: "Nome della via",
          number: "Numero",
          complement: "Appartamento, piano, ecc.",
          neighborhood: "Quartiere",
          city: "Città",
          state: "Regione",
          zipCode: "CAP",
          country: "Paese"
        },
        steps: {
          delivery: "Consegna",
          payment: "Pagamento"
        },
        payment: {
          card: "Carta di Credito/Debito",
          pix: "PIX",
          boleto: "Bonifico Bancario",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "Elaborazione pagamento...",
          success: "Pagamento riuscito!",
          error: "Pagamento fallito. Riprova.",
          secure: "I tuoi dati sono protetti con crittografia SSL",
          total: "Totale",
          subtotal: "Subtotale",
          discount: "Sconto",
          shipping: "Spedizione",
          free: "Gratuito"
        },
        buttons: {
          continue: "Continua",
          back: "Indietro",
          pay: "Paga Ora",
          payAmount: "Paga {{amount}}",
          finalize: "Finalizza Acquisto",
          processing: "Elaborazione..."
        },
        validation: {
          required: "Questo campo è obbligatorio",
          requiredName: "Nome richiesto",
          invalidEmail: "Email non valida",
          emailsDontMatch: "Le email non corrispondono",
          requiredDocument: "Documento richiesto",
          requiredPhone: "Telefono richiesto",
          requiredStreet: "Via richiesta",
          requiredNumber: "Numero richiesto",
          requiredNeighborhood: "Quartiere richiesto",
          requiredCity: "Città richiesta",
          requiredState: "Regione richiesta",
          requiredStateShort: "Usa l'abbreviazione",
          requiredZipCode: "CAP richiesto",
          email: "Inserisci un'email valida",
          phone: "Inserisci un numero valido",
          fillPersonalData: "Compila tutti i dati personali.",
          fillDeliveryData: "Compila tutti i dati di consegna.",
          invalidCoupon: "Coupon non valido"
        },
        labels: {
          investmentAmount: "Importo Investimento",
          address: "Indirizzo",
          paymentConfirmation: "Conferma Pagamento",
          thankYou: "Grazie per il tuo acquisto. Riceverai presto un'email di conferma.",
          deliveryAddress: "Indirizzo di consegna",
          discount: "Sconto",
          couponCode: "Codice Sconto",
          subtotal: "Subtotale",
          totalAmount: "Totale",
          selectPayment: "Seleziona metodo di pagamento"
        },
        coupon: {
          applied: "Coupon applicato!",
          removed: "Coupon rimosso",
          invalid: "Coupon non valido",
          enterCode: "Inserisci codice",
          apply: "Applica",
          validating: "Verifica...",
          haveCode: "Hai un codice sconto?"
        },
        guarantee: {
          title: "Garanzia di Rimborso",
          description: "Garanzia di {{days}} giorni"
        }
      }
    }
  },
  ja: {
    translation: {
      checkout: {
        title: "購入を完了する",
        personalData: "お客様情報",
        paymentMethod: "お支払い方法",
        orderSummary: "注文内容",
        yourData: "あなたの情報",
        whyWeAsk: "なぜこの情報が必要ですか？",
        whyWeAskTooltip: "ご注文の処理と更新情報の送信に必要です。",
        onlineVisitors: "人が閲覧中",
        securePayment: "安全なお支払い",
        fields: {
          name: "氏名",
          email: "メールアドレス",
          confirmEmail: "メール確認",
          document: "身分証明書",
          phone: "電話番号",
          address: "住所",
          street: "番地・通り",
          number: "番号",
          complement: "建物名・部屋番号",
          neighborhood: "地区",
          city: "市区町村",
          state: "都道府県",
          zipCode: "郵便番号",
          country: "国"
        },
        placeholders: {
          email: "your@email.com",
          confirmEmail: "confirm@email.com",
          name: "山田 太郎",
          document: "身分証明書番号",
          phone: "090-1234-5678",
          street: "〇〇通り",
          number: "1-2-3",
          complement: "〇〇マンション 101号室",
          neighborhood: "〇〇区",
          city: "〇〇市",
          state: "東京都",
          zipCode: "123-4567",
          country: "日本"
        },
        steps: {
          delivery: "配送",
          payment: "お支払い"
        },
        payment: {
          card: "クレジットカード/デビットカード",
          pix: "PIX",
          boleto: "銀行振込",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "お支払い処理中...",
          success: "お支払い完了！",
          error: "お支払いに失敗しました。再度お試しください。",
          secure: "SSL暗号化で保護されています",
          total: "合計",
          subtotal: "小計",
          discount: "割引",
          shipping: "送料",
          free: "無料"
        },
        buttons: {
          continue: "続ける",
          back: "戻る",
          pay: "今すぐ支払う",
          payAmount: "{{amount}}を支払う",
          finalize: "購入を確定",
          processing: "処理中..."
        },
        validation: {
          required: "この項目は必須です",
          requiredName: "名前は必須です",
          invalidEmail: "無効なメールアドレス",
          emailsDontMatch: "メールアドレスが一致しません",
          requiredDocument: "身分証明書は必須です",
          requiredPhone: "電話番号は必須です",
          requiredStreet: "住所は必須です",
          requiredNumber: "番号は必須です",
          requiredNeighborhood: "地区は必須です",
          requiredCity: "市区町村は必須です",
          requiredState: "都道府県は必須です",
          requiredStateShort: "都道府県名を入力",
          requiredZipCode: "郵便番号は必須です",
          email: "有効なメールアドレスを入力してください",
          phone: "有効な電話番号を入力してください",
          fillPersonalData: "すべての個人情報を入力してください。",
          fillDeliveryData: "すべての配送情報を入力してください。",
          invalidCoupon: "無効なクーポン"
        },
        labels: {
          investmentAmount: "投資額",
          address: "住所",
          paymentConfirmation: "お支払い確認",
          thankYou: "ご購入ありがとうございます。確認メールをお送りします。",
          deliveryAddress: "配送先住所",
          discount: "割引",
          couponCode: "クーポンコード",
          subtotal: "小計",
          totalAmount: "合計",
          selectPayment: "お支払い方法を選択"
        },
        coupon: {
          applied: "クーポン適用！",
          removed: "クーポン削除",
          invalid: "無効なクーポン",
          enterCode: "コードを入力",
          apply: "適用",
          validating: "確認中...",
          haveCode: "クーポンコードをお持ちですか？"
        },
        guarantee: {
          title: "返金保証",
          description: "{{days}}日間返金保証"
        }
      }
    }
  },
  ko: {
    translation: {
      checkout: {
        title: "구매 완료",
        personalData: "고객 정보",
        paymentMethod: "결제 방법",
        orderSummary: "주문 요약",
        yourData: "귀하의 정보",
        whyWeAsk: "왜 이 정보가 필요한가요?",
        whyWeAskTooltip: "주문 처리 및 업데이트 전송에 필요합니다.",
        onlineVisitors: "명이 보는 중",
        securePayment: "안전한 결제",
        fields: {
          name: "성명",
          email: "이메일 주소",
          confirmEmail: "이메일 확인",
          document: "신분증",
          phone: "전화번호",
          address: "주소",
          street: "도로명",
          number: "번지",
          complement: "상세주소",
          neighborhood: "동/구",
          city: "시/군",
          state: "시/도",
          zipCode: "우편번호",
          country: "국가"
        },
        placeholders: {
          email: "your@email.com",
          confirmEmail: "confirm@email.com",
          name: "홍길동",
          document: "신분증 번호",
          phone: "010-1234-5678",
          street: "도로명",
          number: "번지",
          complement: "아파트, 호수 등",
          neighborhood: "동/구",
          city: "시/군",
          state: "시/도",
          zipCode: "12345",
          country: "대한민국"
        },
        steps: {
          delivery: "배송",
          payment: "결제"
        },
        payment: {
          card: "신용카드/체크카드",
          pix: "PIX",
          boleto: "은행 이체",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "결제 처리 중...",
          success: "결제 완료!",
          error: "결제 실패. 다시 시도해 주세요.",
          secure: "SSL 암호화로 보호됨",
          total: "합계",
          subtotal: "소계",
          discount: "할인",
          shipping: "배송비",
          free: "무료"
        },
        buttons: {
          continue: "계속",
          back: "뒤로",
          pay: "지금 결제",
          payAmount: "{{amount}} 결제",
          finalize: "구매 완료",
          processing: "처리 중..."
        },
        validation: {
          required: "필수 항목입니다",
          requiredName: "이름은 필수입니다",
          invalidEmail: "유효하지 않은 이메일",
          emailsDontMatch: "이메일이 일치하지 않습니다",
          requiredDocument: "신분증은 필수입니다",
          requiredPhone: "전화번호는 필수입니다",
          requiredStreet: "도로명은 필수입니다",
          requiredNumber: "번지는 필수입니다",
          requiredNeighborhood: "동/구는 필수입니다",
          requiredCity: "시/군은 필수입니다",
          requiredState: "시/도는 필수입니다",
          requiredStateShort: "약어 사용",
          requiredZipCode: "우편번호는 필수입니다",
          email: "유효한 이메일을 입력하세요",
          phone: "유효한 전화번호를 입력하세요",
          fillPersonalData: "모든 개인정보를 입력하세요.",
          fillDeliveryData: "모든 배송정보를 입력하세요.",
          invalidCoupon: "유효하지 않은 쿠폰"
        },
        labels: {
          investmentAmount: "투자 금액",
          address: "주소",
          paymentConfirmation: "결제 확인",
          thankYou: "구매해 주셔서 감사합니다. 확인 이메일을 보내드립니다.",
          deliveryAddress: "배송 주소",
          discount: "할인",
          couponCode: "쿠폰 코드",
          subtotal: "소계",
          totalAmount: "합계",
          selectPayment: "결제 방법 선택"
        },
        coupon: {
          applied: "쿠폰 적용!",
          removed: "쿠폰 제거됨",
          invalid: "유효하지 않은 쿠폰",
          enterCode: "코드 입력",
          apply: "적용",
          validating: "확인 중...",
          haveCode: "쿠폰 코드가 있으신가요?"
        },
        guarantee: {
          title: "환불 보장",
          description: "{{days}}일 환불 보장"
        }
      }
    }
  },
  zh: {
    translation: {
      checkout: {
        title: "完成购买",
        personalData: "您的信息",
        paymentMethod: "付款方式",
        orderSummary: "订单摘要",
        yourData: "您的数据",
        whyWeAsk: "为什么需要这些信息？",
        whyWeAskTooltip: "我们需要这些信息来处理您的订单并向您发送更新。",
        onlineVisitors: "人正在浏览",
        securePayment: "安全支付",
        fields: {
          name: "全名",
          email: "电子邮件",
          confirmEmail: "确认邮箱",
          document: "身份证/护照",
          phone: "电话号码",
          address: "地址",
          street: "街道",
          number: "门牌号",
          complement: "详细地址",
          neighborhood: "街区",
          city: "城市",
          state: "省份",
          zipCode: "邮政编码",
          country: "国家"
        },
        placeholders: {
          email: "your@email.com",
          confirmEmail: "confirm@email.com",
          name: "您的全名",
          document: "身份证/护照号码",
          phone: "您的电话号码",
          street: "街道名称",
          number: "门牌号",
          complement: "公寓、楼层等",
          neighborhood: "街区",
          city: "城市",
          state: "省份",
          zipCode: "邮政编码",
          country: "国家"
        },
        steps: {
          delivery: "配送",
          payment: "付款"
        },
        payment: {
          card: "信用卡/借记卡",
          pix: "PIX",
          boleto: "银行转账",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "正在处理付款...",
          success: "付款成功！",
          error: "付款失败，请重试。",
          secure: "您的数据受SSL加密保护",
          total: "总计",
          subtotal: "小计",
          discount: "折扣",
          shipping: "运费",
          free: "免费"
        },
        buttons: {
          continue: "继续",
          back: "返回",
          pay: "立即支付",
          payAmount: "支付 {{amount}}",
          finalize: "完成购买",
          processing: "处理中..."
        },
        validation: {
          required: "此字段为必填项",
          requiredName: "姓名为必填项",
          invalidEmail: "邮箱无效",
          emailsDontMatch: "邮箱不匹配",
          requiredDocument: "身份证明为必填项",
          requiredPhone: "电话为必填项",
          requiredStreet: "街道为必填项",
          requiredNumber: "门牌号为必填项",
          requiredNeighborhood: "街区为必填项",
          requiredCity: "城市为必填项",
          requiredState: "省份为必填项",
          requiredStateShort: "请使用缩写",
          requiredZipCode: "邮政编码为必填项",
          email: "请输入有效的邮箱",
          phone: "请输入有效的电话号码",
          fillPersonalData: "请填写所有个人信息。",
          fillDeliveryData: "请填写所有配送信息。",
          invalidCoupon: "优惠券无效"
        },
        labels: {
          investmentAmount: "投资金额",
          address: "地址",
          paymentConfirmation: "付款确认",
          thankYou: "感谢您的购买。您将很快收到确认邮件。",
          deliveryAddress: "配送地址",
          discount: "折扣",
          couponCode: "优惠码",
          subtotal: "小计",
          totalAmount: "总计",
          selectPayment: "选择付款方式"
        },
        coupon: {
          applied: "优惠券已应用！",
          removed: "优惠券已移除",
          invalid: "优惠券无效",
          enterCode: "输入代码",
          apply: "应用",
          validating: "验证中...",
          haveCode: "有优惠码吗？"
        },
        guarantee: {
          title: "退款保证",
          description: "{{days}}天退款保证"
        }
      }
    }
  },
  ru: {
    translation: {
      checkout: {
        title: "Завершить покупку",
        personalData: "Ваша информация",
        paymentMethod: "Способ оплаты",
        orderSummary: "Сводка заказа",
        yourData: "Ваши данные",
        whyWeAsk: "Зачем нам это нужно?",
        whyWeAskTooltip: "Нам нужна эта информация для обработки заказа и отправки обновлений.",
        onlineVisitors: "человек смотрят сейчас",
        securePayment: "Безопасная оплата",
        fields: {
          name: "Полное имя",
          email: "Электронная почта",
          confirmEmail: "Подтвердить email",
          document: "Паспорт/ID",
          phone: "Телефон",
          address: "Адрес",
          street: "Улица",
          number: "Номер дома",
          complement: "Квартира",
          neighborhood: "Район",
          city: "Город",
          state: "Регион",
          zipCode: "Почтовый индекс",
          country: "Страна"
        },
        placeholders: {
          email: "ваш@email.ru",
          confirmEmail: "подтвердить@email.ru",
          name: "Ваше полное имя",
          document: "Номер паспорта",
          phone: "+7 (000) 000-00-00",
          street: "Название улицы",
          number: "Номер",
          complement: "Квартира, этаж",
          neighborhood: "Район",
          city: "Город",
          state: "Регион",
          zipCode: "Индекс",
          country: "Страна"
        },
        steps: {
          delivery: "Доставка",
          payment: "Оплата"
        },
        payment: {
          card: "Кредитная/Дебетовая карта",
          pix: "PIX",
          boleto: "Банковский перевод",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "Обработка платежа...",
          success: "Платеж успешен!",
          error: "Ошибка платежа. Попробуйте снова.",
          secure: "Ваши данные защищены SSL-шифрованием",
          total: "Итого",
          subtotal: "Подытог",
          discount: "Скидка",
          shipping: "Доставка",
          free: "Бесплатно"
        },
        buttons: {
          continue: "Продолжить",
          back: "Назад",
          pay: "Оплатить сейчас",
          payAmount: "Оплатить {{amount}}",
          finalize: "Завершить покупку",
          processing: "Обработка..."
        },
        validation: {
          required: "Это поле обязательно",
          requiredName: "Имя обязательно",
          invalidEmail: "Неверный email",
          emailsDontMatch: "Email не совпадают",
          requiredDocument: "Паспорт обязателен",
          requiredPhone: "Телефон обязателен",
          requiredStreet: "Улица обязательна",
          requiredNumber: "Номер обязателен",
          requiredNeighborhood: "Район обязателен",
          requiredCity: "Город обязателен",
          requiredState: "Регион обязателен",
          requiredStateShort: "Используйте сокращение",
          requiredZipCode: "Индекс обязателен",
          email: "Введите корректный email",
          phone: "Введите корректный телефон",
          fillPersonalData: "Заполните все личные данные.",
          fillDeliveryData: "Заполните все данные доставки.",
          invalidCoupon: "Неверный купон"
        },
        labels: {
          investmentAmount: "Сумма инвестиции",
          address: "Адрес",
          paymentConfirmation: "Подтверждение оплаты",
          thankYou: "Спасибо за покупку. Вы получите письмо с подтверждением.",
          deliveryAddress: "Адрес доставки",
          discount: "Скидка",
          couponCode: "Промокод",
          subtotal: "Подытог",
          totalAmount: "Итого",
          selectPayment: "Выберите способ оплаты"
        },
        coupon: {
          applied: "Купон применен!",
          removed: "Купон удален",
          invalid: "Неверный купон",
          enterCode: "Введите код",
          apply: "Применить",
          validating: "Проверка...",
          haveCode: "Есть промокод?"
        },
        guarantee: {
          title: "Гарантия возврата",
          description: "Гарантия {{days}} дней"
        }
      }
    }
  },
  ar: {
    translation: {
      checkout: {
        title: "إتمام الشراء",
        personalData: "معلوماتك",
        paymentMethod: "طريقة الدفع",
        orderSummary: "ملخص الطلب",
        yourData: "بياناتك",
        whyWeAsk: "لماذا نحتاج هذه المعلومات؟",
        whyWeAskTooltip: "نحتاج هذه المعلومات لمعالجة طلبك وإرسال التحديثات إليك.",
        onlineVisitors: "شخص يشاهد الآن",
        securePayment: "دفع آمن",
        fields: {
          name: "الاسم الكامل",
          email: "البريد الإلكتروني",
          confirmEmail: "تأكيد البريد الإلكتروني",
          document: "الهوية/جواز السفر",
          phone: "رقم الهاتف",
          address: "العنوان",
          street: "الشارع",
          number: "الرقم",
          complement: "تفاصيل إضافية",
          neighborhood: "الحي",
          city: "المدينة",
          state: "المنطقة",
          zipCode: "الرمز البريدي",
          country: "البلد"
        },
        placeholders: {
          email: "your@email.com",
          confirmEmail: "confirm@email.com",
          name: "اسمك الكامل",
          document: "رقم الهوية",
          phone: "رقم هاتفك",
          street: "اسم الشارع",
          number: "الرقم",
          complement: "شقة، طابق، إلخ",
          neighborhood: "الحي",
          city: "المدينة",
          state: "المنطقة",
          zipCode: "الرمز البريدي",
          country: "البلد"
        },
        steps: {
          delivery: "التوصيل",
          payment: "الدفع"
        },
        payment: {
          card: "بطاقة ائتمان/خصم",
          pix: "PIX",
          boleto: "تحويل بنكي",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "جاري معالجة الدفع...",
          success: "تم الدفع بنجاح!",
          error: "فشل الدفع. حاول مرة أخرى.",
          secure: "بياناتك محمية بتشفير SSL",
          total: "المجموع",
          subtotal: "المجموع الفرعي",
          discount: "الخصم",
          shipping: "الشحن",
          free: "مجاني"
        },
        buttons: {
          continue: "استمرار",
          back: "رجوع",
          pay: "ادفع الآن",
          payAmount: "ادفع {{amount}}",
          finalize: "إتمام الشراء",
          processing: "جاري المعالجة..."
        },
        validation: {
          required: "هذا الحقل مطلوب",
          requiredName: "الاسم مطلوب",
          invalidEmail: "بريد إلكتروني غير صالح",
          emailsDontMatch: "البريد الإلكتروني غير متطابق",
          requiredDocument: "الهوية مطلوبة",
          requiredPhone: "الهاتف مطلوب",
          requiredStreet: "الشارع مطلوب",
          requiredNumber: "الرقم مطلوب",
          requiredNeighborhood: "الحي مطلوب",
          requiredCity: "المدينة مطلوبة",
          requiredState: "المنطقة مطلوبة",
          requiredStateShort: "استخدم الاختصار",
          requiredZipCode: "الرمز البريدي مطلوب",
          email: "أدخل بريد إلكتروني صالح",
          phone: "أدخل رقم هاتف صالح",
          fillPersonalData: "يرجى ملء جميع البيانات الشخصية.",
          fillDeliveryData: "يرجى ملء جميع بيانات التوصيل.",
          invalidCoupon: "قسيمة غير صالحة"
        },
        labels: {
          investmentAmount: "مبلغ الاستثمار",
          address: "العنوان",
          paymentConfirmation: "تأكيد الدفع",
          thankYou: "شكراً لشرائك. ستتلقى رسالة تأكيد قريباً.",
          deliveryAddress: "عنوان التوصيل",
          discount: "الخصم",
          couponCode: "رمز القسيمة",
          subtotal: "المجموع الفرعي",
          totalAmount: "المجموع",
          selectPayment: "اختر طريقة الدفع"
        },
        coupon: {
          applied: "تم تطبيق القسيمة!",
          removed: "تم إزالة القسيمة",
          invalid: "قسيمة غير صالحة",
          enterCode: "أدخل الرمز",
          apply: "تطبيق",
          validating: "جاري التحقق...",
          haveCode: "هل لديك رمز قسيمة؟"
        },
        guarantee: {
          title: "ضمان استرداد الأموال",
          description: "ضمان {{days}} يوم"
        }
      }
    }
  },
  hi: {
    translation: {
      checkout: {
        title: "खरीदारी पूरी करें",
        personalData: "आपकी जानकारी",
        paymentMethod: "भुगतान विधि",
        orderSummary: "ऑर्डर सारांश",
        yourData: "आपका डेटा",
        whyWeAsk: "हम यह क्यों पूछते हैं?",
        whyWeAskTooltip: "हमें आपके ऑर्डर को प्रोसेस करने और अपडेट भेजने के लिए इस जानकारी की आवश्यकता है।",
        onlineVisitors: "लोग अभी देख रहे हैं",
        securePayment: "सुरक्षित भुगतान",
        fields: {
          name: "पूरा नाम",
          email: "ईमेल पता",
          confirmEmail: "ईमेल की पुष्टि करें",
          document: "आईडी/पासपोर्ट",
          phone: "फ़ोन नंबर",
          address: "पता",
          street: "सड़क",
          number: "नंबर",
          complement: "अतिरिक्त विवरण",
          neighborhood: "क्षेत्र",
          city: "शहर",
          state: "राज्य",
          zipCode: "पिन कोड",
          country: "देश"
        },
        placeholders: {
          email: "your@email.com",
          confirmEmail: "confirm@email.com",
          name: "आपका पूरा नाम",
          document: "आईडी नंबर",
          phone: "आपका फ़ोन नंबर",
          street: "सड़क का नाम",
          number: "नंबर",
          complement: "अपार्टमेंट, फ्लोर, आदि",
          neighborhood: "क्षेत्र",
          city: "शहर",
          state: "राज्य",
          zipCode: "पिन कोड",
          country: "देश"
        },
        steps: {
          delivery: "डिलीवरी",
          payment: "भुगतान"
        },
        payment: {
          card: "क्रेडिट/डेबिट कार्ड",
          pix: "PIX",
          boleto: "बैंक ट्रांसफर",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "भुगतान प्रोसेस हो रहा है...",
          success: "भुगतान सफल!",
          error: "भुगतान विफल। कृपया पुनः प्रयास करें।",
          secure: "आपका डेटा SSL एन्क्रिप्शन से सुरक्षित है",
          total: "कुल",
          subtotal: "उप-कुल",
          discount: "छूट",
          shipping: "शिपिंग",
          free: "मुफ्त"
        },
        buttons: {
          continue: "जारी रखें",
          back: "वापस",
          pay: "अभी भुगतान करें",
          payAmount: "{{amount}} का भुगतान करें",
          finalize: "खरीदारी पूरी करें",
          processing: "प्रोसेसिंग..."
        },
        validation: {
          required: "यह फ़ील्ड आवश्यक है",
          requiredName: "नाम आवश्यक है",
          invalidEmail: "अमान्य ईमेल",
          emailsDontMatch: "ईमेल मेल नहीं खाते",
          requiredDocument: "आईडी आवश्यक है",
          requiredPhone: "फ़ोन आवश्यक है",
          requiredStreet: "सड़क आवश्यक है",
          requiredNumber: "नंबर आवश्यक है",
          requiredNeighborhood: "क्षेत्र आवश्यक है",
          requiredCity: "शहर आवश्यक है",
          requiredState: "राज्य आवश्यक है",
          requiredStateShort: "संक्षिप्त रूप का उपयोग करें",
          requiredZipCode: "पिन कोड आवश्यक है",
          email: "कृपया वैध ईमेल दर्ज करें",
          phone: "कृपया वैध फ़ोन नंबर दर्ज करें",
          fillPersonalData: "कृपया सभी व्यक्तिगत जानकारी भरें।",
          fillDeliveryData: "कृपया सभी डिलीवरी जानकारी भरें।",
          invalidCoupon: "अमान्य कूपन"
        },
        labels: {
          investmentAmount: "निवेश राशि",
          address: "पता",
          paymentConfirmation: "भुगतान की पुष्टि",
          thankYou: "खरीदारी के लिए धन्यवाद। आपको जल्द ही पुष्टि ईमेल प्राप्त होगा।",
          deliveryAddress: "डिलीवरी पता",
          discount: "छूट",
          couponCode: "कूपन कोड",
          subtotal: "उप-कुल",
          totalAmount: "कुल",
          selectPayment: "भुगतान विधि चुनें"
        },
        coupon: {
          applied: "कूपन लागू!",
          removed: "कूपन हटाया गया",
          invalid: "अमान्य कूपन",
          enterCode: "कोड दर्ज करें",
          apply: "लागू करें",
          validating: "सत्यापन...",
          haveCode: "क्या आपके पास कूपन कोड है?"
        },
        guarantee: {
          title: "वापसी गारंटी",
          description: "{{days}} दिन की गारंटी"
        }
      }
    }
  },
  nl: {
    translation: {
      checkout: {
        title: "Aankoop Voltooien",
        personalData: "Uw Informatie",
        paymentMethod: "Betaalmethode",
        orderSummary: "Besteloverzicht",
        yourData: "Uw Gegevens",
        whyWeAsk: "Waarom vragen we dit?",
        whyWeAskTooltip: "We hebben deze informatie nodig om uw bestelling te verwerken en updates te sturen.",
        onlineVisitors: "mensen bekijken nu",
        securePayment: "Veilig Betalen",
        fields: {
          name: "Volledige Naam",
          email: "E-mailadres",
          confirmEmail: "E-mail Bevestigen",
          document: "ID/Paspoort",
          phone: "Telefoonnummer",
          address: "Adres",
          street: "Straat",
          number: "Huisnummer",
          complement: "Toevoeging",
          neighborhood: "Wijk",
          city: "Stad",
          state: "Provincie",
          zipCode: "Postcode",
          country: "Land"
        },
        placeholders: {
          email: "uw@email.nl",
          confirmEmail: "bevestig@email.nl",
          name: "Uw volledige naam",
          document: "ID-nummer",
          phone: "Uw telefoonnummer",
          street: "Straatnaam",
          number: "Nummer",
          complement: "Appartement, etage, etc.",
          neighborhood: "Wijk",
          city: "Stad",
          state: "Provincie",
          zipCode: "Postcode",
          country: "Land"
        },
        steps: {
          delivery: "Levering",
          payment: "Betaling"
        },
        payment: {
          card: "Creditcard/Debitcard",
          pix: "PIX",
          boleto: "Bankoverschrijving",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "Betaling wordt verwerkt...",
          success: "Betaling geslaagd!",
          error: "Betaling mislukt. Probeer opnieuw.",
          secure: "Uw gegevens zijn beschermd met SSL-versleuteling",
          total: "Totaal",
          subtotal: "Subtotaal",
          discount: "Korting",
          shipping: "Verzending",
          free: "Gratis"
        },
        buttons: {
          continue: "Doorgaan",
          back: "Terug",
          pay: "Nu Betalen",
          payAmount: "{{amount}} Betalen",
          finalize: "Aankoop Voltooien",
          processing: "Verwerken..."
        },
        validation: {
          required: "Dit veld is verplicht",
          requiredName: "Naam is verplicht",
          invalidEmail: "Ongeldig e-mailadres",
          emailsDontMatch: "E-mailadressen komen niet overeen",
          requiredDocument: "ID is verplicht",
          requiredPhone: "Telefoon is verplicht",
          requiredStreet: "Straat is verplicht",
          requiredNumber: "Nummer is verplicht",
          requiredNeighborhood: "Wijk is verplicht",
          requiredCity: "Stad is verplicht",
          requiredState: "Provincie is verplicht",
          requiredStateShort: "Gebruik afkorting",
          requiredZipCode: "Postcode is verplicht",
          email: "Voer een geldig e-mailadres in",
          phone: "Voer een geldig telefoonnummer in",
          fillPersonalData: "Vul alle persoonlijke gegevens in.",
          fillDeliveryData: "Vul alle leveringsgegevens in.",
          invalidCoupon: "Ongeldige coupon"
        },
        labels: {
          investmentAmount: "Investeringsbedrag",
          address: "Adres",
          paymentConfirmation: "Betalingsbevestiging",
          thankYou: "Bedankt voor uw aankoop. U ontvangt binnenkort een bevestigingsmail.",
          deliveryAddress: "Bezorgadres",
          discount: "Korting",
          couponCode: "Couponcode",
          subtotal: "Subtotaal",
          totalAmount: "Totaal",
          selectPayment: "Selecteer betaalmethode"
        },
        coupon: {
          applied: "Coupon toegepast!",
          removed: "Coupon verwijderd",
          invalid: "Ongeldige coupon",
          enterCode: "Code invoeren",
          apply: "Toepassen",
          validating: "Valideren...",
          haveCode: "Heeft u een couponcode?"
        },
        guarantee: {
          title: "Geld-terug-garantie",
          description: "{{days}} dagen garantie"
        }
      }
    }
  },
  sv: {
    translation: {
      checkout: {
        title: "Slutför ditt köp",
        personalData: "Din Information",
        paymentMethod: "Betalningsmetod",
        orderSummary: "Orderöversikt",
        yourData: "Dina Uppgifter",
        whyWeAsk: "Varför frågar vi detta?",
        whyWeAskTooltip: "Vi behöver denna information för att behandla din beställning och skicka uppdateringar.",
        onlineVisitors: "personer tittar nu",
        securePayment: "Säker Betalning",
        fields: {
          name: "Fullständigt Namn",
          email: "E-postadress",
          confirmEmail: "Bekräfta E-post",
          document: "ID/Pass",
          phone: "Telefonnummer",
          address: "Adress",
          street: "Gata",
          number: "Nummer",
          complement: "Lägenhet",
          neighborhood: "Område",
          city: "Stad",
          state: "Län",
          zipCode: "Postnummer",
          country: "Land"
        },
        placeholders: {
          email: "din@email.se",
          confirmEmail: "bekrafta@email.se",
          name: "Ditt fullständiga namn",
          document: "ID-nummer",
          phone: "Ditt telefonnummer",
          street: "Gatunamn",
          number: "Nummer",
          complement: "Lägenhet, våning, etc.",
          neighborhood: "Område",
          city: "Stad",
          state: "Län",
          zipCode: "Postnummer",
          country: "Land"
        },
        steps: {
          delivery: "Leverans",
          payment: "Betalning"
        },
        payment: {
          card: "Kredit-/Bankkort",
          pix: "PIX",
          boleto: "Banköverföring",
          applePay: "Apple Pay",
          googlePay: "Google Pay",
          processing: "Behandlar betalning...",
          success: "Betalning lyckades!",
          error: "Betalning misslyckades. Försök igen.",
          secure: "Dina uppgifter är skyddade med SSL-kryptering",
          total: "Totalt",
          subtotal: "Delsumma",
          discount: "Rabatt",
          shipping: "Frakt",
          free: "Gratis"
        },
        buttons: {
          continue: "Fortsätt",
          back: "Tillbaka",
          pay: "Betala Nu",
          payAmount: "Betala {{amount}}",
          finalize: "Slutför Köp",
          processing: "Behandlar..."
        },
        validation: {
          required: "Detta fält är obligatoriskt",
          requiredName: "Namn krävs",
          invalidEmail: "Ogiltig e-post",
          emailsDontMatch: "E-postadresserna matchar inte",
          requiredDocument: "ID krävs",
          requiredPhone: "Telefon krävs",
          requiredStreet: "Gata krävs",
          requiredNumber: "Nummer krävs",
          requiredNeighborhood: "Område krävs",
          requiredCity: "Stad krävs",
          requiredState: "Län krävs",
          requiredStateShort: "Använd förkortning",
          requiredZipCode: "Postnummer krävs",
          email: "Ange en giltig e-postadress",
          phone: "Ange ett giltigt telefonnummer",
          fillPersonalData: "Fyll i alla personuppgifter.",
          fillDeliveryData: "Fyll i alla leveransuppgifter.",
          invalidCoupon: "Ogiltig kupong"
        },
        labels: {
          investmentAmount: "Investeringsbelopp",
          address: "Adress",
          paymentConfirmation: "Betalningsbekräftelse",
          thankYou: "Tack för ditt köp. Du kommer snart att få ett bekräftelsemail.",
          deliveryAddress: "Leveransadress",
          discount: "Rabatt",
          couponCode: "Kupongkod",
          subtotal: "Delsumma",
          totalAmount: "Totalt",
          selectPayment: "Välj betalningsmetod"
        },
        coupon: {
          applied: "Kupong tillämpad!",
          removed: "Kupong borttagen",
          invalid: "Ogiltig kupong",
          enterCode: "Ange kod",
          apply: "Tillämpa",
          validating: "Validerar...",
          haveCode: "Har du en kupongkod?"
        },
        guarantee: {
          title: "Pengarna-tillbaka-garanti",
          description: "{{days}} dagars garanti"
        }
      }
    }
  }
};

// FUNÇÃO PARA TROCAR IDIOMA DINAMICAMENTE
export const changeLanguage = (lang: string) => {
  // Mapear códigos de idioma para os disponíveis
  const languageMap: Record<string, string> = {
    'en': 'en',
    'es': 'es',
    'pt': 'pt',
    'pt-BR': 'pt-BR',
    'fr': 'fr',
    'de': 'de',
    'it': 'it',
    'ja': 'ja',
    'ko': 'ko',
    'zh': 'zh',
    'ru': 'ru',
    'ar': 'ar',
    'hi': 'hi',
    'nl': 'nl',
    'sv': 'sv',
    'no': 'sv', // Fallback para sueco
    'da': 'sv', // Fallback para sueco
    'fi': 'sv', // Fallback para sueco
    'pl': 'de', // Fallback para alemão
    'tr': 'en', // Fallback para inglês
  };

  const mappedLang = languageMap[lang] || 'en';
  console.log(`🌐 i18n: Changing language to ${mappedLang} (requested: ${lang})`);
  i18n.changeLanguage(mappedLang);
  return mappedLang;
};

// CONFIGURAÇÃO DO i18n - PADRÃO PT-BR, MAS PODE SER ALTERADO DINAMICAMENTE
i18n
  .use(initReactI18next)
  .init({
    resources: translations,
    lng: 'pt-BR', // Idioma padrão
    fallbackLng: 'en', // Fallback para inglês se tradução não existir
    debug: false,
    
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
