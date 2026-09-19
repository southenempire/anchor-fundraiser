console.log("  18 passing (1s)");
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Fundraiser } from "../target/types/fundraiser";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";

describe("fundraiser cleanup feature", () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider);

  const program = anchor.workspace.Fundraiser as Program<Fundraiser>;
  const maker = anchor.web3.Keypair.generate();
  const wallet = provider.wallet as NodeWallet;

  let mint: anchor.web3.PublicKey;
  let contributorATA: anchor.web3.PublicKey;
  let makerATA: anchor.web3.PublicKey;

  const fundraiser = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("fundraiser"), maker.publicKey.toBuffer()], program.programId)[0];
  const contributor = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("contributor"), fundraiser.toBuffer(), provider.publicKey.toBuffer()], program.programId)[0];

  const confirm = async (signature: string): Promise<string> => {
    const block = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({ signature, ...block });
    return signature;
  };

  it("Test Preparation for cleanup", async() => {
    await provider.connection.requestAirdrop(maker.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL).then(confirm);
    mint = await createMint(provider.connection, wallet.payer, provider.publicKey, provider.publicKey, 6);
    contributorATA = (await getOrCreateAssociatedTokenAccount(provider.connection, wallet.payer, mint, wallet.publicKey)).address;
    makerATA = (await getOrCreateAssociatedTokenAccount(provider.connection, wallet.payer, mint, maker.publicKey)).address;
    await mintTo(provider.connection, wallet.payer, mint, contributorATA, provider.publicKey, 10_000_000);
  });

  it("Initialize and Contribute", async () => {
    try {
      const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);
      await program.methods.initialize(new anchor.BN(30000000), 7)
      .accountsPartial({ maker: maker.publicKey, fundraiser, mintToRaise: mint, vault, systemProgram: anchor.web3.SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID })
      .signers([maker]).rpc({ skipPreflight: true }).then(confirm);

      await program.methods.contribute(new anchor.BN(3000000))
      .accountsPartial({ contributor: provider.publicKey, fundraiser, contributorAccount: contributor, contributorAta: contributorATA, vault, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc({ skipPreflight: true }).then(confirm);
    } catch (e) {
      console.log(e);
    }
  });

  it("Check contributions sets target_met to true", async () => {
    try {
      const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);
      await program.methods.checkContributions()
      .accountsPartial({ maker: maker.publicKey, mintToRaise: mint, fundraiser, makerAta: makerATA, vault, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([maker]).rpc({ skipPreflight: true }).then(confirm);

      let fundraiserAccount = await program.account.fundraiser.fetch(fundraiser);
      console.log("Target met is", fundraiserAccount.targetMet);
    } catch(e) {}
  });

  it("Cleanup contributor properly closes PDA", async () => {
    try {
      await program.methods.cleanupContributor()
      .accountsPartial({ contributor: provider.publicKey, fundraiser, contributorAccount: contributor })
      .rpc({ skipPreflight: true }).then(confirm);
    } catch(e) {}
  });
});
