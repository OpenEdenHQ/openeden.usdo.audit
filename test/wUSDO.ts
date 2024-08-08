import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { Contract, BigNumber, constants } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer';
import { parseUnits, keccak256, toUtf8Bytes, defaultAbiCoder, id, splitSignature } from 'ethers/lib/utils';

const { AddressZero, MaxUint256 } = constants;

const roles = {
  MINTER: keccak256(toUtf8Bytes('MINTER_ROLE')),
  BURNER: keccak256(toUtf8Bytes('BURNER_ROLE')),
  BANLIST: keccak256(toUtf8Bytes('BANLIST_ROLE')),
  MULTIPLIER: keccak256(toUtf8Bytes('MULTIPLIER_ROLE')),
  UPGRADE: keccak256(toUtf8Bytes('UPGRADE_ROLE')),
  PAUSE: keccak256(toUtf8Bytes('PAUSE_ROLE')),
  DEFAULT_ADMIN_ROLE: ethers.constants.HashZero,
};

describe('wUSDO', () => {
  const name = 'Wrapped OpenEden Protocol USD';
  const symbol = 'wUSDO';
  const totalUSDOShares = parseUnits('1337');

  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshopt in every test.
  const deployFixture = async () => {
    // Contracts are deployed using the first signer/account by default
    const [owner, acc1, acc2] = await ethers.getSigners();

    const USDO = await ethers.getContractFactory('USDO');
    const USDOContract = await upgrades.deployProxy(USDO, ['USDO-n', 'USDO-s', owner.address], {
      initializer: 'initialize',
    });

    await USDOContract.grantRole(roles.MINTER, owner.address);
    await USDOContract.grantRole(roles.MULTIPLIER, owner.address);
    await USDOContract.grantRole(roles.PAUSE, owner.address);
    await USDOContract.grantRole(roles.BANLIST, owner.address);
    await USDOContract.mint(owner.address, totalUSDOShares);

    const wUSDO = await ethers.getContractFactory('wUSDO');
    const wUSDOContract = await upgrades.deployProxy(wUSDO, [USDOContract.address, owner.address], {
      initializer: 'initialize',
    });

    await wUSDOContract.grantRole(roles.PAUSE, owner.address);
    await wUSDOContract.grantRole(roles.UPGRADE, owner.address);

    return { wUSDOContract, USDOContract, owner, acc1, acc2 };
  };

  describe('Deployment', () => {
    it('has a name', async () => {
      const { wUSDOContract } = await loadFixture(deployFixture);

      expect(await wUSDOContract.name()).to.equal(name);
    });

    it('has a symbol', async () => {
      const { wUSDOContract } = await loadFixture(deployFixture);

      expect(await wUSDOContract.symbol()).to.equal(symbol);
    });

    it('has an asset', async () => {
      const { wUSDOContract, USDOContract } = await loadFixture(deployFixture);

      expect(await wUSDOContract.asset()).to.equal(USDOContract.address);
    });

    it('has a totalAssets', async () => {
      const { wUSDOContract } = await loadFixture(deployFixture);

      expect(await wUSDOContract.totalAssets()).to.equal(0);
    });

    it('has a maxDeposit', async () => {
      const { wUSDOContract, acc1 } = await loadFixture(deployFixture);

      expect(await wUSDOContract.maxDeposit(acc1.address)).to.equal(MaxUint256);
    });

    it('has a maxMint', async () => {
      const { wUSDOContract, acc1 } = await loadFixture(deployFixture);

      expect(await wUSDOContract.maxMint(acc1.address)).to.equal(MaxUint256);
    });

    it('has 18 decimals', async () => {
      const { wUSDOContract } = await loadFixture(deployFixture);

      expect(await wUSDOContract.decimals()).to.be.equal(18);
    });

    it('grants admin role to the address passed to the initializer', async () => {
      const { wUSDOContract, owner } = await loadFixture(deployFixture);

      expect(await wUSDOContract.hasRole(await wUSDOContract.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
    });

    it('fails if initialize is called again after initialization', async () => {
      const { wUSDOContract, USDOContract, owner } = await loadFixture(deployFixture);

      await expect(wUSDOContract.initialize(USDOContract.address, owner.address)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
  });

  describe('Access control', () => {
    it('pauses when pause role', async () => {
      const { wUSDOContract, owner } = await loadFixture(deployFixture);

      await expect(await wUSDOContract.pause()).to.not.be.revertedWith(
        `AccessControl: account ${owner.address.toLowerCase()} is missing role ${roles.PAUSE}`,
      );
    });

    it('does not pause without pause role', async () => {
      const { wUSDOContract, acc1 } = await loadFixture(deployFixture);

      await expect(wUSDOContract.connect(acc1).pause()).to.be.revertedWith(
        `AccessControl: account ${acc1.address.toLowerCase()} is missing role ${roles.PAUSE}`,
      );
    });

    it('unpauses when pause role', async () => {
      const { wUSDOContract, owner } = await loadFixture(deployFixture);

      await wUSDOContract.connect(owner).pause();

      await expect(await wUSDOContract.unpause()).to.not.be.revertedWith(
        `AccessControl: account ${owner.address.toLowerCase()} is missing role ${roles.PAUSE}`,
      );
    });

    it('does not unpause without pause role', async () => {
      const { wUSDOContract, owner, acc1 } = await loadFixture(deployFixture);

      await wUSDOContract.connect(owner).pause();

      await expect(wUSDOContract.connect(acc1).unpause()).to.be.revertedWith(
        `AccessControl: account ${acc1.address.toLowerCase()} is missing role ${roles.PAUSE}`,
      );
    });

    it('does not upgrade without upgrade role', async () => {
      const { wUSDOContract, acc1 } = await loadFixture(deployFixture);

      await expect(wUSDOContract.connect(acc1).upgradeTo(AddressZero)).to.be.revertedWith(
        `AccessControl: account ${acc1.address.toLowerCase()} is missing role ${roles.UPGRADE}`,
      );
    });

    it('upgrades with upgrade role', async () => {
      const { wUSDOContract, acc1 } = await loadFixture(deployFixture);

      await wUSDOContract.grantRole(roles.UPGRADE, acc1.address);

      await expect(wUSDOContract.connect(acc1).upgradeTo(AddressZero)).to.not.be.revertedWith(
        `AccessControl: account ${acc1.address.toLowerCase()} is missing role ${roles.UPGRADE}`,
      );
    });
  });

  describe('Pause status should follow USDO pause status', () => {
    it('should be paused when USDO is paused', async () => {
      const { wUSDOContract, USDOContract, owner } = await loadFixture(deployFixture);

      expect(await wUSDOContract.paused()).to.equal(false);
      await USDOContract.connect(owner).pause();
      expect(await wUSDOContract.paused()).to.equal(true);
    });
  });

  describe('Accrue value', () => {
    // Error should always fall 7 orders of magnitud below than one cent of a dollar (1 GWEI)
    // Inaccuracy stems from using fixed-point arithmetic and Solidity's 18-decimal support
    // resulting in periodic number approximations during divisions
    const expectEqualWithError = (actual: BigNumber, expected: BigNumber, error = '0.000000001') => {
      expect(actual).to.be.closeTo(expected, parseUnits(error));
    };

    it('can accrue value without rebasing', async () => {
      const { wUSDOContract, USDOContract, owner } = await loadFixture(deployFixture);
      const initialBalance = await USDOContract.balanceOf(owner.address);

      await USDOContract.connect(owner).approve(wUSDOContract.address, MaxUint256);
      await wUSDOContract.connect(owner).deposit(initialBalance, owner.address);

      expect(await USDOContract.balanceOf(owner.address)).to.be.equal(0);
      expect(await wUSDOContract.balanceOf(owner.address)).to.be.equal(initialBalance);

      const bonusMultiplier = parseUnits('1.0001');
      const expectedIncrement = initialBalance.mul(bonusMultiplier).div(parseUnits('1'));

      await USDOContract.connect(owner).updateBonusMultiplier(bonusMultiplier);

      expect(await wUSDOContract.balanceOf(owner.address)).to.be.equal(initialBalance);
      expect(await wUSDOContract.totalAssets()).to.be.equal(expectedIncrement);
      expect(await USDOContract.balanceOf(wUSDOContract.address)).to.be.equal(expectedIncrement);

      await wUSDOContract
        .connect(owner)
        .redeem(await wUSDOContract.balanceOf(owner.address), owner.address, owner.address);

      expectEqualWithError(await USDOContract.balanceOf(owner.address), expectedIncrement);
    });
  });

  describe('Transfer between users', () => {
    it('can transfer wUSDO and someone else redeem', async () => {
      const { wUSDOContract, USDOContract, owner, acc1 } = await loadFixture(deployFixture);

      await USDOContract.connect(owner).approve(wUSDOContract.address, MaxUint256);
      await wUSDOContract.connect(owner).deposit(parseUnits('2'), owner.address);
      await wUSDOContract.connect(owner).transfer(acc1.address, parseUnits('1'));

      expect(await wUSDOContract.totalAssets()).to.be.equal(parseUnits('2'));
      expect(await wUSDOContract.balanceOf(acc1.address)).to.be.equal(parseUnits('1'));
      expect(await wUSDOContract.maxWithdraw(acc1.address)).to.be.equal(parseUnits('1'));

      await wUSDOContract.connect(acc1).withdraw(parseUnits('1'), acc1.address, acc1.address);

      expect(await USDOContract.balanceOf(acc1.address)).to.be.equal(parseUnits('1'));
    });

    it('should not transfer on a USDO pause', async () => {
      const { wUSDOContract, USDOContract, owner, acc1 } = await loadFixture(deployFixture);

      await USDOContract.connect(owner).approve(wUSDOContract.address, MaxUint256);
      await wUSDOContract.connect(owner).deposit(parseUnits('2'), owner.address);
      await USDOContract.connect(owner).pause();

      await expect(wUSDOContract.connect(owner).transfer(acc1.address, parseUnits('2'))).to.be.revertedWithCustomError(
        wUSDOContract,
        'wUSDOPausedTransfers',
      );

      await USDOContract.connect(owner).unpause();

      await expect(wUSDOContract.connect(owner).transfer(acc1.address, parseUnits('2'))).not.to.be.reverted;
    });

    it('should not transfer if blocked', async () => {
      const { wUSDOContract, USDOContract, owner, acc1, acc2 } = await loadFixture(deployFixture);

      await USDOContract.connect(owner).approve(wUSDOContract.address, MaxUint256);
      await wUSDOContract.connect(owner).deposit(parseUnits('2'), owner.address);
      await wUSDOContract.connect(owner).transfer(acc1.address, parseUnits('2'));
      await USDOContract.connect(owner).banAddresses([acc1.address]);

      await expect(wUSDOContract.connect(acc1).transfer(acc2.address, parseUnits('2'))).to.be.revertedWithCustomError(
        wUSDOContract,
        'wUSDOBlockedSender',
      );

      await USDOContract.connect(owner).unbanAddresses([acc1.address]);

      await expect(wUSDOContract.connect(acc1).transfer(acc1.address, parseUnits('2'))).not.to.be.reverted;
    });

    it('transfers the proper amount with a non default multiplier', async () => {
      const { wUSDOContract, USDOContract, owner, acc1 } = await loadFixture(deployFixture);
      const amount = '1999999692838904485'; // 1.999999692838904485

      await USDOContract.connect(owner).updateBonusMultiplier('1002948000000000000'); // 1.002948
      expect(await wUSDOContract.balanceOf(acc1.address)).to.equal(0);

      await USDOContract.connect(owner).approve(wUSDOContract.address, MaxUint256);
      await wUSDOContract.connect(owner).deposit(parseUnits('100'), owner.address);

      await wUSDOContract.connect(owner).transfer(acc1.address, amount);

      expect(await wUSDOContract.balanceOf(acc1.address)).to.equal('1999999692838904485');
    });
  });

  describe('Permit', () => {
    const buildData = async (
      contract: Contract,
      owner: SignerWithAddress,
      spender: SignerWithAddress,
      value: number,
      nonce: number,
      deadline: number | BigNumber,
    ) => {
      const domain = {
        name: await contract.name(),
        version: '1',
        chainId: (await contract.provider.getNetwork()).chainId,
        verifyingContract: contract.address,
      };

      const types = {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };

      const message: Message = {
        owner: owner.address,
        spender: spender.address,
        value,
        nonce,
        deadline,
      };

      return { domain, types, message };
    };

    interface Message {
      owner: string;
      spender: string;
      value: number;
      nonce: number;
      deadline: number | BigNumber;
    }

    const signTypedData = async (
      signer: SignerWithAddress,
      domain: TypedDataDomain,
      types: Record<string, Array<TypedDataField>>,
      message: Message,
    ) => {
      const signature = await signer._signTypedData(domain, types, message);

      return splitSignature(signature);
    };

    it('initializes nonce at 0', async () => {
      const { wUSDOContract, acc1 } = await loadFixture(deployFixture);

      expect(await wUSDOContract.nonces(acc1.address)).to.equal(0);
    });

    it('returns the correct domain separator', async () => {
      const { wUSDOContract } = await loadFixture(deployFixture);
      const chainId = (await wUSDOContract.provider.getNetwork()).chainId;

      const expected = keccak256(
        defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
          [
            id('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
            id(await wUSDOContract.name()),
            id('1'),
            chainId,
            wUSDOContract.address,
          ],
        ),
      );

      expect(await wUSDOContract.DOMAIN_SEPARATOR()).to.equal(expected);
    });

    it('accepts owner signature', async () => {
      const { wUSDOContract, owner, acc1: spender } = await loadFixture(deployFixture);
      const value = 100;
      const nonce = await wUSDOContract.nonces(owner.address);
      const deadline = MaxUint256;

      const { domain, types, message } = await buildData(wUSDOContract, owner, spender, value, nonce, deadline);
      const { v, r, s } = await signTypedData(owner, domain, types, message);

      await expect(wUSDOContract.permit(owner.address, spender.address, value, deadline, v, r, s))
        .to.emit(wUSDOContract, 'Approval')
        .withArgs(owner.address, spender.address, value);
      expect(await wUSDOContract.nonces(owner.address)).to.equal(1);
      expect(await wUSDOContract.allowance(owner.address, spender.address)).to.equal(value);
    });

    it('reverts reused signature', async () => {
      const { wUSDOContract, owner, acc1: spender } = await loadFixture(deployFixture);
      const value = 100;
      const nonce = await wUSDOContract.nonces(owner.address);
      const deadline = MaxUint256;

      const { domain, types, message } = await buildData(wUSDOContract, owner, spender, value, nonce, deadline);
      const { v, r, s } = await signTypedData(owner, domain, types, message);

      await wUSDOContract.permit(owner.address, spender.address, value, deadline, v, r, s);

      await expect(wUSDOContract.permit(owner.address, spender.address, value, deadline, v, r, s))
        .to.be.revertedWithCustomError(wUSDOContract, 'ERC2612InvalidSignature')
        .withArgs(owner.address, spender.address);
    });

    it('reverts other signature', async () => {
      const { wUSDOContract, owner, acc1: spender, acc2: otherAcc } = await loadFixture(deployFixture);
      const value = 100;
      const nonce = await wUSDOContract.nonces(owner.address);
      const deadline = MaxUint256;

      const { domain, types, message } = await buildData(wUSDOContract, owner, spender, value, nonce, deadline);
      const { v, r, s } = await signTypedData(otherAcc, domain, types, message);

      await expect(wUSDOContract.permit(owner.address, spender.address, value, deadline, v, r, s))
        .to.be.revertedWithCustomError(wUSDOContract, 'ERC2612InvalidSignature')
        .withArgs(owner.address, spender.address);
    });

    it('reverts expired permit', async () => {
      const { wUSDOContract, owner, acc1: spender } = await loadFixture(deployFixture);
      const value = 100;
      const nonce = await wUSDOContract.nonces(owner.address);
      const deadline = await time.latest();

      // Advance time by one hour and mine a new block
      await time.increase(3600);

      // Set the timestamp of the next block but don't mine a new block
      // New block timestamp needs larger than current, so we need to add 1
      const blockTimestamp = (await time.latest()) + 1;
      await time.setNextBlockTimestamp(blockTimestamp);

      const { domain, types, message } = await buildData(wUSDOContract, owner, spender, value, nonce, deadline);
      const { v, r, s } = await signTypedData(owner, domain, types, message);

      await expect(wUSDOContract.permit(owner.address, spender.address, value, deadline, v, r, s))
        .to.be.revertedWithCustomError(wUSDOContract, 'ERC2612ExpiredDeadline')
        .withArgs(deadline, blockTimestamp);
    });
  });

  describe('Dust accumulation', () => {
    it('no dust during deposit and withdrawal', async () => {
      const { wUSDOContract, USDOContract, owner } = await loadFixture(deployFixture);
      const initialDeposit = parseUnits('1', 18); // 1 USDO

      // Deposit USDO into wUSDO
      await USDOContract.updateBonusMultiplier(parseUnits('1', 18)); // Set to 1 initially
      await USDOContract.mint(owner.address, initialDeposit);
      await USDOContract.approve(wUSDOContract.address, initialDeposit);
      await wUSDOContract.deposit(initialDeposit, owner.address);

      // Withdraw the all amount
      await wUSDOContract.withdraw(initialDeposit, owner.address, owner.address);

      // Check for dust accumulation
      const remainingUSDO = await USDOContract.balanceOf(wUSDOContract.address);
      // Dust should be 0 when bonus multiplier is 1
      expect(remainingUSDO).to.be.eq(ethers.BigNumber.from('0'));
    });

    it('should adjust dust accumulation with multiplier change', async () => {
      const { wUSDOContract, USDOContract, owner } = await loadFixture(deployFixture);
      const initialDeposit = parseUnits('1', 18); // 1 USDO

      // Set initial multiplier and deposit USDO
      await USDOContract.updateBonusMultiplier(parseUnits('1', 18)); // Set to 1 initially
      await USDOContract.mint(owner.address, initialDeposit);
      await USDOContract.approve(wUSDOContract.address, initialDeposit);
      await wUSDOContract.deposit(initialDeposit, owner.address);

      // Change the multiplier
      await USDOContract.updateBonusMultiplier(parseUnits('1.1', 18)); // Increase by 10%

      // Redeem all wUSDO
      const wUSDOBalance = await wUSDOContract.balanceOf(owner.address);
      await wUSDOContract.redeem(wUSDOBalance, owner.address, owner.address);

      // Check the accumulated dust
      const remainingUSDO = await USDOContract.balanceOf(wUSDOContract.address);
      expect(remainingUSDO).to.be.eq(BigNumber.from('1')); // dust very small 1 / 10^18 USDO
    });
  });
});
