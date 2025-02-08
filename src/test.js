async function getQuoteForSwap(inputAddr, outputAddr, amount, slippageBps) {
  try {
    const response = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputAddr}&outputMint=${outputAddr}&amount=${amount}&slippageBps=${slippageBps}`
    );
    const quote = await response.json();
    if (quote.error) {
      throw new Error(quote.message);
    }
    console.log('quote:', quote);
    return quote;
  } catch (error) {
    console.error('Error while getQuoteForSwap:', error);
    throw new Error(error.message || 'Unexpected error while fetch the quote for swap');
  }
}

getQuoteForSwap('So11111111111111111111111111111111111111112', '9EZn5Tt1nean3QzrXiJeBK4UwS1cPksyDmn4akdX9rgo', 1000, 50);
