import { ethers } from 'ethers'
import { BigNumber } from 'ethers/utils'
import React, { useEffect, useMemo, useState } from 'react'
import { RouteComponentProps, withRouter } from 'react-router-dom'
import styled from 'styled-components'

import { MARKET_FEE } from '../../common/constants'
import { useConnectedWeb3Context } from '../../hooks/connectedWeb3'
import { useAsyncDerivedValue } from '../../hooks/useAsyncDerivedValue'
import { useCollateralBalance } from '../../hooks/useCollateralBalance'
import { useContracts } from '../../hooks/useContracts'
import { useCpk } from '../../hooks/useCpk'
import { useCpkAllowance } from '../../hooks/useCpkAllowance'
import { MarketMakerService } from '../../services'
import { getLogger } from '../../util/logger'
import { computeBalanceAfterTrade, formatBigNumber, formatDate } from '../../util/tools'
import { BalanceItem, OutcomeTableValue, Status, Token } from '../../util/types'
import { Button, ButtonContainer } from '../button'
import { ButtonType } from '../button/button_styling_types'
import {
  BigNumberInput,
  DisplayArbitrator,
  GridTransactionDetails,
  GridTwoColumns,
  SectionTitle,
  SubsectionTitle,
  SubsectionTitleAction,
  SubsectionTitleWrapper,
  TextfieldCustomPlaceholder,
  TitleValue,
  ViewCard,
  WalletBalance,
} from '../common'
import { BigNumberInputReturn } from '../common/big_number_input'
import { OutcomeTable } from '../common/outcome_table'
import { SetAllowance } from '../common/set_allowance'
import { FullLoading } from '../loading'
import { ModalTwitterShare } from '../modal/modal_twitter_share'

import { TransactionDetailsCard } from './transaction_details_card'
import { TransactionDetailsLine } from './transaction_details_line'
import { TransactionDetailsRow, ValueStates } from './transaction_details_row'
import { useMarketMakerData } from '../../hooks'

const LeftButton = styled(Button)`
  margin-right: auto;
`

const logger = getLogger('Market::Buy')

interface Props extends RouteComponentProps<any> {
  marketMakerAddress: string
  balances: BalanceItem[]
  collateral: Token
  question: string
  resolution: Maybe<Date>
}

const MarketBuyWrapper: React.FC<Props> = (props: Props) => {
  const context = useConnectedWeb3Context()
  const cpk = useCpk()
  const { library: provider } = context
  const signer = useMemo(() => provider.getSigner(), [provider])

  const { buildMarketMaker } = useContracts(context)
  const { balances, collateral, marketMakerAddress, question } = props
  const marketMaker = useMemo(() => buildMarketMaker(marketMakerAddress), [buildMarketMaker, marketMakerAddress])
  const { marketMakerData } = useMarketMakerData(marketMakerAddress, context)
  const {
    userEarnings,
    totalEarnings,
    marketMakerFunding,
    marketMakerUserFunding,
    arbitrator,
    resolution,
    category,
  } = marketMakerData

  const [status, setStatus] = useState<Status>(Status.Ready)
  const [outcomeIndex, setOutcomeIndex] = useState<number>(0)
  const [cost, setCost] = useState<BigNumber>(new BigNumber(0))
  const [amount, setAmount] = useState<BigNumber>(new BigNumber(0))
  const [message, setMessage] = useState<string>('')
  const [isModalTwitterShareOpen, setModalTwitterShareState] = useState(false)
  const [messageTwitter, setMessageTwitter] = useState('')
  const [showingExtraInformation, setExtraInformation] = useState(false)

  const toggleExtraInformation = () =>
    showingExtraInformation ? setExtraInformation(false) : setExtraInformation(true)

  const [allowanceFinished, setAllowanceFinished] = useState(false)
  const { allowance, unlock } = useCpkAllowance(signer, collateral.address)

  const hasEnoughAllowance = allowance && allowance.gte(amount)

  // get the amount of shares that will be traded and the estimated prices after trade
  const calcBuyAmount = useMemo(
    () => async (amount: BigNumber): Promise<[BigNumber, number[]]> => {
      const tradedShares = await marketMaker.calcBuyAmount(amount, outcomeIndex)
      const balanceAfterTrade = computeBalanceAfterTrade(
        balances.map(b => b.holdings),
        outcomeIndex,
        amount,
        tradedShares,
      )
      const pricesAfterTrade = MarketMakerService.getActualPrice(balanceAfterTrade)

      const probabilities = pricesAfterTrade.map(priceAfterTrade => priceAfterTrade * 100)

      return [tradedShares, probabilities]
    },
    [balances, marketMaker, outcomeIndex],
  )

  const [tradedShares, probabilities] = useAsyncDerivedValue(
    amount,
    [new BigNumber(0), balances.map(() => 0)],
    calcBuyAmount,
  )

  useEffect(() => {
    const valueNumber = +ethers.utils.formatUnits(amount, collateral.decimals)

    const weiPerUnit = ethers.utils.bigNumberify(10).pow(collateral.decimals)
    const marketFeeWithTwoDecimals = MARKET_FEE / Math.pow(10, 2)
    const costWithFee = ethers.utils
      .bigNumberify('' + Math.round(valueNumber * (1 + marketFeeWithTwoDecimals) * 10000)) // cast to string to avoid overflows
      .mul(weiPerUnit)
      .div(10000)
    setCost(costWithFee)
  }, [amount, collateral.decimals])

  const collateralBalance = useCollateralBalance(collateral, context)

  const unlockCollateral = async () => {
    if (!cpk) {
      return
    }

    await unlock()
    setAllowanceFinished(true)
  }

  const finish = async () => {
    try {
      if (!cpk) {
        return
      }

      setStatus(Status.Loading)
      setMessage(`Buying ${formatBigNumber(tradedShares, collateral.decimals)} shares ...`)

      await cpk.buyOutcomes({
        amount,
        outcomeIndex,
        marketMaker,
      })

      setMessageTwitter(
        `Your outcome was successfully created. You obtain ${formatBigNumber(
          tradedShares,
          collateral.decimals,
        )} shares.`,
      )
      setAmount(new BigNumber(0))
      setStatus(Status.Ready)

      setModalTwitterShareState(true)
    } catch (err) {
      setStatus(Status.Error)
      logger.log(`Error trying to buy: ${err.message}`)
    }
  }

  const isBuyAmountGreaterThanBalance = amount.gt(collateralBalance)

  const error =
    (status !== Status.Ready && status !== Status.Error) ||
    cost.isZero() ||
    isBuyAmountGreaterThanBalance ||
    amount.isZero() ||
    !hasEnoughAllowance

  const noteAmount = `${formatBigNumber(collateralBalance, collateral.decimals)} ${collateral.symbol}`

  const amountFee = cost.sub(amount)
  const mockedPotential = 1.03
  const fee = `${formatBigNumber(amountFee.mul(-1), collateral.decimals)} ${collateral.symbol}`
  const baseCost = `${formatBigNumber(amount.sub(amountFee), collateral.decimals)} ${collateral.symbol}`
  const potentialProfit = `${mockedPotential} ${collateral.symbol}`
  const sharesTotal = formatBigNumber(tradedShares, collateral.decimals)
  const total = `${sharesTotal} Shares`

  const hasZeroAllowance = allowance && allowance.isZero()
  const showSetAllowance = allowanceFinished || hasZeroAllowance || !hasEnoughAllowance

  return (
    <>
      <SectionTitle goBackEnabled title={question} />
      <ViewCard>
        <SubsectionTitleWrapper>
          <SubsectionTitle>Purchase Outcome</SubsectionTitle>
          <SubsectionTitleAction onClick={toggleExtraInformation}>
            {showingExtraInformation ? 'Hide' : 'Show'} Pool Information
          </SubsectionTitleAction>
        </SubsectionTitleWrapper>

        <GridTwoColumns>
          {showingExtraInformation ? (
            <>
              <TitleValue
                title={'Total Pool Tokens'}
                value={formatBigNumber(marketMakerFunding, collateral.decimals)}
              />
              <TitleValue
                title={'Total Pool Earings'}
                value={`${formatBigNumber(userEarnings, collateral.decimals)} ${collateral.symbol}`}
              />
              <TitleValue
                title={'My Pool Tokens'}
                value={formatBigNumber(marketMakerUserFunding, collateral.decimals)}
              />
              <TitleValue
                title={'My Pool Earnings'}
                value={`${formatBigNumber(totalEarnings, collateral.decimals)} ${collateral.symbol}`}
              />
            </>
          ) : null}
          <TitleValue title={'Category'} value={category} />
          <TitleValue title={'Resolution Date'} value={resolution && formatDate(resolution)} />
          <TitleValue title={'Arbitrator/Oracle'} value={arbitrator && <DisplayArbitrator arbitrator={arbitrator} />} />
          <TitleValue title={'24h Volume'} value={'425,523 DAI'} />
        </GridTwoColumns>

        <OutcomeTable
          balances={balances}
          collateral={collateral}
          disabledColumns={[OutcomeTableValue.Payout, OutcomeTableValue.Shares]}
          outcomeHandleChange={(value: number) => setOutcomeIndex(value)}
          outcomeSelected={outcomeIndex}
          probabilities={probabilities}
        />
        <GridTransactionDetails>
          <div>
            <WalletBalance value={noteAmount} />
            <TextfieldCustomPlaceholder
              formField={
                <BigNumberInput
                  decimals={collateral.decimals}
                  name="amount"
                  onChange={(e: BigNumberInputReturn) => setAmount(e.value)}
                  value={amount}
                />
              }
              placeholderText={collateral.symbol}
            />
          </div>
          <div>
            <TransactionDetailsCard>
              <TransactionDetailsRow title={'Fee'} value={fee} />
              <TransactionDetailsRow title={'Base Cost'} value={baseCost} />
              <TransactionDetailsLine />
              <TransactionDetailsRow
                emphasizeValue={mockedPotential > 0}
                state={ValueStates.success}
                title={'Potential Profit'}
                value={potentialProfit}
              />
              <TransactionDetailsRow
                emphasizeValue={parseFloat(sharesTotal) > 0}
                state={(parseFloat(sharesTotal) > 0 && ValueStates.important) || ValueStates.normal}
                title={'Total'}
                value={total}
              />
            </TransactionDetailsCard>
          </div>
        </GridTransactionDetails>
        {showSetAllowance && (
          <SetAllowance
            collateral={collateral}
            finished={allowanceFinished}
            loading={allowance === null}
            onUnlock={unlockCollateral}
          />
        )}
        <ButtonContainer>
          <LeftButton
            buttonType={ButtonType.secondaryLine}
            onClick={() => props.history.push(`/${marketMakerAddress}`)}
          >
            Cancel
          </LeftButton>
          <Button buttonType={ButtonType.secondaryLine} disabled={error} onClick={() => finish()}>
            Buy
          </Button>
        </ButtonContainer>
      </ViewCard>
      <ModalTwitterShare
        description={messageTwitter}
        isOpen={isModalTwitterShareOpen}
        onClose={() => setModalTwitterShareState(false)}
        shareUrl={`${window.location.protocol}//${window.location.hostname}/#/${marketMakerAddress}`}
        title={'Outcome created'}
      />
      {status === Status.Loading && <FullLoading message={message} />}
    </>
  )
}

export const MarketBuy = withRouter(MarketBuyWrapper)
